// KeywordSpy Popup JS
'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  keywordData: {},
  groups: [],
  currentTab: null,
  currentDomain: null,
  currentPageType: null,
  activeView: 'main',
  activeDomainKey: null,
  activeGroupId: null,
  kwFilter: '',
  kwSort: 'frequency',
  settings: { autoAppStore: true, minFreq: 2 }
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  await loadCurrentTab();
  setupEventListeners();
  renderAll();
});

async function loadData() {
  const data = await msg('GET_ALL_DATA');
  state.keywordData = data.keywordData || {};
  state.groups = data.groups || [];
  const saved = await chrome.storage.local.get('settings');
  if (saved.settings) state.settings = { ...state.settings, ...saved.settings };
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.currentTab = tab;
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      const h = url.hostname;
      if (h === 'apps.apple.com') {
        state.currentPageType = 'appstore';
        const match = url.pathname.match(/\/app\/([^\/]+)\/(id\d+)/);
        state.currentDomain = match
          ? 'apps.apple.com/app/' + match[1] + '/' + match[2]
          : 'apps.apple.com' + url.pathname;
      } else if (h === 'play.google.com') {
        state.currentPageType = 'playstore';
        const appId = url.searchParams.get('id');
        state.currentDomain = appId
          ? 'play.google.com/store/apps/details?id=' + appId
          : 'play.google.com' + url.pathname;
      } else {
        state.currentPageType = 'website';
        state.currentDomain = h;
      }
    } catch {}
  }
}

function msg(type, data = {}) {
  return chrome.runtime.sendMessage({ type, ...data });
}

// Returns a short human-readable label for any tracking key
function keyLabel(key) {
  if (!key) return '';
  // App Store: apps.apple.com/app/myfitnesspal/id123456
  const asMatch = key.match(/apps\.apple\.com\/app\/([^/]+)\//);
  if (asMatch) return asMatch[1].replace(/-/g, ' ');
  // Play Store: play.google.com/store/apps/details?id=com.example.app
  const psMatch = key.match(/id=([^&]+)/);
  if (psMatch) {
    const parts = psMatch[1].split('.');
    return parts[parts.length - 1];  // last segment of package name
  }
  return key;
}

// Returns badge type for a tracking key or pageType
function keyPageType(key, pageType) {
  if (pageType) return pageType;
  if (key && key.startsWith('apps.apple.com')) return 'appstore';
  if (key && key.startsWith('play.google.com')) return 'playstore';
  return 'website';
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderCurrentPageBar();
  renderGroups();
}

function renderCurrentPageBar() {
  const domainEl = document.getElementById('current-domain');
  const badgeEl = document.getElementById('current-badge');
  const kwCountEl = document.getElementById('current-kw-count');
  const addBtn = document.getElementById('btn-add-to-group');

  if (!state.currentDomain) {
    domainEl.textContent = 'No page detected';
    badgeEl.textContent = '';
    badgeEl.className = 'badge';
    kwCountEl.textContent = '';
    addBtn.style.display = 'none';
    return;
  }

  domainEl.textContent = keyLabel(state.currentDomain) || state.currentDomain;

  const domainData = state.keywordData[state.currentDomain];
  const isTracked = domainData || isInAnyGroup(state.currentDomain);

  const pt = keyPageType(state.currentDomain, state.currentPageType);
  if (pt === 'appstore') {
    badgeEl.textContent = 'APP STORE';
    badgeEl.className = 'badge appstore';
  } else if (pt === 'playstore') {
    badgeEl.textContent = 'PLAY STORE';
    badgeEl.className = 'badge playstore';
  } else if (isTracked) {
    badgeEl.textContent = 'WEB';
    badgeEl.className = 'badge website';
  } else {
    badgeEl.textContent = 'NEW';
    badgeEl.className = 'badge new';
  }

  if (domainData) {
    const count = Object.keys(domainData.keywords || {}).length;
    kwCountEl.textContent = `✓ ${count} kw`;
  } else {
    kwCountEl.textContent = '';
  }

  addBtn.style.display = state.groups.length ? 'block' : 'none';
}

function renderGroups() {
  const container = document.getElementById('groups-container');
  if (!state.groups.length) {
    container.innerHTML = `<div class="empty-state">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.3"><rect x="4" y="8" width="10" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="18" y="8" width="10" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>
      <p>No groups yet.<br/>Create one to start tracking.</p>
    </div>`;
    return;
  }

  container.innerHTML = state.groups.map(group => {
    const domains = group.domains || [];
    const totalKw = domains.reduce((sum, d) => {
      const kd = state.keywordData[d.domain];
      return sum + (kd ? Object.keys(kd.keywords || {}).length : 0);
    }, 0);

    const domainsHTML = domains.map(d => {
      const kd = state.keywordData[d.domain];
      const kwCount = kd ? Object.keys(kd.keywords || {}).length : 0;
      const pt = keyPageType(d.domain, d.pageType || (kd && kd.pageType));
      const label = keyLabel(d.domain) || d.domain;
      const badgeCls = pt === 'appstore' ? 'as' : pt === 'playstore' ? 'ps' : 'w';
      const badgeTxt = pt === 'appstore' ? 'AS' : pt === 'playstore' ? 'PS' : 'W';
      return `<div class="domain-item" data-domain="${esc(d.domain)}" data-group="${esc(group.id)}">
        <div class="domain-favicon-placeholder">${label.charAt(0).toUpperCase()}</div>
        <span class="domain-name" title="${esc(d.domain)}">${esc(label)}</span>
        <span class="domain-badge ${badgeCls}">${badgeTxt}</span>
        <span class="domain-kw-count">${kwCount}</span>
        <button class="btn-tiny danger domain-remove" data-domain="${esc(d.domain)}" data-group="${esc(group.id)}" title="Remove">×</button>
      </div>`;
    }).join('');

    return `<div class="group-item" id="group-${esc(group.id)}">
      <div class="group-header" data-group-id="${esc(group.id)}">
        <span class="group-chevron">▶</span>
        <span class="group-name">${esc(group.name)}</span>
        <span class="group-count">${domains.length} domains · ${totalKw} kw</span>
        <div class="group-actions">
          <button class="btn-tiny btn-compare-group" data-group="${esc(group.id)}" title="Compare">≈</button>
          <button class="btn-tiny danger btn-delete-group" data-group="${esc(group.id)}" title="Delete">×</button>
        </div>
      </div>
      <div class="domains-list">${domainsHTML || '<div style="padding:8px 30px;font-size:11px;color:var(--text-2)">No domains yet</div>'}</div>
    </div>`;
  }).join('');
}

function renderDomainView(domainKey) {
  state.activeDomainKey = domainKey;
  const domainData = state.keywordData[domainKey];
  if (!domainData) return;

  document.getElementById('domain-view-title').textContent = keyLabel(domainKey) || domainKey;
  renderKeywordList();
  renderMetadata();
  switchView('domain');
}

function renderKeywordList() {
  const domainData = state.keywordData[state.activeDomainKey];
  const list = document.getElementById('keyword-list');
  if (!domainData || !domainData.keywords) {
    list.innerHTML = '<div class="no-keywords">No keywords yet. Browse a page to capture.</div>';
    return;
  }

  let entries = Object.entries(domainData.keywords)
    .filter(([kw, info]) => !info.dismissed)
    .filter(([kw]) => !state.kwFilter || kw.includes(state.kwFilter.toLowerCase()));

  const minFreq = state.settings.minFreq || 1;
  entries = entries.filter(([, info]) => info.pinned || info.frequency >= minFreq);

  // Sort
  if (state.kwSort === 'frequency') {
    entries.sort(([, a], [, b]) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      return b.frequency - a.frequency;
    });
  } else if (state.kwSort === 'alpha') {
    entries.sort(([a], [b]) => a.localeCompare(b));
  } else if (state.kwSort === 'source') {
    entries.sort(([, a], [, b]) => (a.sources[0] || '').localeCompare(b.sources[0] || ''));
  } else if (state.kwSort === 'date') {
    entries.sort(([, a], [, b]) => (b.firstSeen || 0) - (a.firstSeen || 0));
  }

  const maxFreq = Math.max(1, ...entries.map(([, v]) => v.frequency));

  if (!entries.length) {
    list.innerHTML = '<div class="no-keywords">No keywords match your filter.</div>';
    return;
  }

  list.innerHTML = entries.map(([kw, info]) => {
    const barWidth = Math.round((info.frequency / maxFreq) * 100);
    const sources = (info.sources || []).slice(0, 3);
    return `<div class="kw-item ${info.pinned ? 'pinned' : ''}">
      <span class="kw-word" title="${esc(kw)}">${esc(kw)}</span>
      <div class="kw-bar-wrap"><div class="kw-bar" style="width:${barWidth}%"></div></div>
      <span class="kw-freq">${info.frequency}</span>
      <div class="kw-sources">${sources.map(s => `<span class="kw-source-chip">${esc(shortSource(s))}</span>`).join('')}</div>
      <div class="kw-actions">
        <button class="kw-pin ${info.pinned ? 'active' : ''}" data-kw="${esc(kw)}" title="Pin">📌</button>
        <button class="kw-dismiss" data-kw="${esc(kw)}" title="Hide">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderMetadata() {
  const domainData = state.keywordData[state.activeDomainKey];
  const panel = document.getElementById('metadata-panel');
  if (!domainData || !domainData.metadata || !domainData.metadata.length) {
    panel.innerHTML = '<div class="no-keywords">No metadata captured yet.</div>';
    return;
  }
  const latest = domainData.metadata[domainData.metadata.length - 1];

  const rows = [
    { label: 'TITLE', value: latest.title },
    { label: 'DESCRIPTION', value: latest.description },
    { label: 'META KEYWORDS', value: latest.keywords || '—' },
    { label: 'OG TITLE', value: latest.ogTitle || '—' },
    { label: 'OG DESCRIPTION', value: latest.ogDescription || '—' },
    { label: 'CANONICAL', value: latest.canonical ? `<a href="${esc(latest.canonical)}" target="_blank">${esc(latest.canonical)}</a>` : '—' },
    { label: 'SCHEMA TYPE', value: latest.schemaType || '—' },
    { label: 'PAGES CAPTURED', value: domainData.totalPages || 1 },
  ].filter(r => r.value && r.value !== '—');

  panel.innerHTML = rows.map((r, i) => `
    ${i > 0 ? '<div class="meta-divider"></div>' : ''}
    <div class="meta-row">
      <span class="meta-label">${r.label}</span>
      <span class="meta-value">${r.value}</span>
    </div>`).join('');
}

function renderCompareView() {
  const checks = document.getElementById('compare-checkboxes');
  checks.innerHTML = state.groups.map(g => `
    <label class="compare-checkbox-item" data-group="${esc(g.id)}">
      <input type="checkbox" value="${esc(g.id)}"/>
      <div class="compare-check-indicator"></div>
      <span>${esc(g.name)} (${(g.domains || []).length} domains)</span>
    </label>`).join('');

  // Restore previous selections on click
  checks.querySelectorAll('.compare-checkbox-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      const ind = item.querySelector('.compare-check-indicator');
      ind.textContent = item.classList.contains('selected') ? '✓' : '';
    });
  });

  document.getElementById('compare-results').style.display = 'none';
  switchView('compare');
}

function runComparison() {
  const selected = [...document.querySelectorAll('.compare-checkbox-item.selected')].map(el => el.dataset.group);
  if (selected.length < 2) {
    alert('Select at least 2 groups to compare.');
    return;
  }

  const groups = selected.map(id => state.groups.find(g => g.id === id)).filter(Boolean);
  const groupKws = groups.map(g => {
    const allKws = {};
    for (const d of (g.domains || [])) {
      const kd = state.keywordData[d.domain];
      if (!kd) continue;
      for (const [kw, info] of Object.entries(kd.keywords || {})) {
        if (!allKws[kw]) allKws[kw] = 0;
        allKws[kw] += info.frequency;
      }
    }
    return { group: g, keywords: allKws };
  });

  // Shared: in all groups
  const allSets = groupKws.map(gk => new Set(Object.keys(gk.keywords)));
  const shared = [...allSets[0]].filter(kw => allSets.every(s => s.has(kw))).slice(0, 60);

  // Unique per group
  const unique = groupKws.map((gk, i) => {
    const others = groupKws.filter((_, j) => j !== i).map(g => new Set(Object.keys(g.keywords)));
    return Object.keys(gk.keywords).filter(kw => others.every(s => !s.has(kw))).slice(0, 40);
  });

  // Gap: if first group is "My App" — what competitors have that we don't
  const myGroup = groupKws[0];
  const gaps = [];
  for (let i = 1; i < groupKws.length; i++) {
    const compKws = Object.keys(groupKws[i].keywords);
    compKws.filter(kw => !myGroup.keywords[kw]).forEach(kw => {
      if (!gaps.includes(kw)) gaps.push(kw);
    });
  }

  // Heatmap: top 20 keywords across all
  const allFreqs = {};
  groupKws.forEach(gk => {
    for (const [kw, freq] of Object.entries(gk.keywords)) {
      allFreqs[kw] = (allFreqs[kw] || 0) + freq;
    }
  });
  const heatmapKws = Object.entries(allFreqs).sort(([,a],[,b]) => b-a).slice(0, 20).map(([kw]) => kw);

  const resultsEl = document.getElementById('compare-results');
  resultsEl.style.display = 'block';

  let html = '';

  // Shared
  html += `<div class="compare-section-header">SHARED (${shared.length})</div>
  <div class="compare-kw-grid">${shared.map(kw => `<span class="compare-kw-chip shared">${esc(kw)}</span>`).join('')}</div>`;

  // Unique per group
  groups.forEach((g, i) => {
    html += `<div class="compare-section-header">UNIQUE TO: ${esc(g.name).toUpperCase()} (${unique[i].length})</div>
    <div class="compare-kw-grid">${unique[i].slice(0,40).map(kw => `<span class="compare-kw-chip unique">${esc(kw)}</span>`).join('')}</div>`;
  });

  // Gap
  if (gaps.length) {
    html += `<div class="compare-section-header">GAP ANALYSIS — ${esc(groups[0].name).toUpperCase()} IS MISSING (${gaps.length})</div>
    <div class="compare-kw-grid">${gaps.slice(0,50).map(kw => `<span class="compare-kw-chip gap">${esc(kw)}</span>`).join('')}</div>`;
  }

  // Heatmap
  const maxTotal = Math.max(1, ...heatmapKws.map(kw => allFreqs[kw] || 0));
  html += `<div class="compare-section-header">FREQUENCY HEATMAP</div>`;
  heatmapKws.forEach(kw => {
    html += `<div class="heatmap-row"><span class="heatmap-kw" title="${esc(kw)}">${esc(kw)}</span>`;
    groupKws.forEach((gk, i) => {
      const freq = gk.keywords[kw] || 0;
      const pct = Math.round((freq / maxTotal) * 100);
      const opacity = freq ? (0.2 + (pct / 100) * 0.8) : 0.05;
      const colors = ['#38bdf8','#818cf8','#34d399','#fb923c'];
      html += `<div class="heatmap-cell" style="background:${colors[i % colors.length]};opacity:${opacity}" title="${gk.group.name}: ${freq}">${freq || ''}</div>`;
    });
    html += `</div>`;
  });

  resultsEl.innerHTML = html;
  document.getElementById('compare-selector') && (document.querySelector('.compare-selector').style.display = 'none');
}

// ─── Events ───────────────────────────────────────────────────────────────────
function setupEventListeners() {
  // Header buttons
  document.getElementById('btn-compare').addEventListener('click', () => {
    if (state.groups.length < 2) { alert('Create at least 2 groups to compare.'); return; }
    renderCompareView();
  });
  document.getElementById('btn-settings').addEventListener('click', () => switchView('settings'));

  // Back buttons
  document.getElementById('btn-back-from-domain').addEventListener('click', () => switchView('main'));
  document.getElementById('btn-back-from-compare').addEventListener('click', () => {
    document.querySelector('.compare-selector').style.display = 'block';
    switchView('main');
  });
  document.getElementById('btn-back-from-settings').addEventListener('click', () => switchView('main'));

  // New group
  document.getElementById('btn-new-group').addEventListener('click', () => showModal('modal-new-group'));
  document.getElementById('btn-cancel-group').addEventListener('click', () => hideModal('modal-new-group'));
  document.getElementById('btn-create-group').addEventListener('click', createGroup);
  document.getElementById('input-group-name').addEventListener('keydown', e => { if (e.key === 'Enter') createGroup(); });

  // Add to group
  document.getElementById('btn-add-to-group').addEventListener('click', showAddDomainModal);
  document.getElementById('btn-cancel-add').addEventListener('click', () => hideModal('modal-add-domain'));

  // Groups container (event delegation)
  document.getElementById('groups-container').addEventListener('click', e => {
    const groupHeader = e.target.closest('.group-header');
    const deleteBtn = e.target.closest('.btn-delete-group');
    const domainItem = e.target.closest('.domain-item');
    const removeBtn = e.target.closest('.domain-remove');

    if (removeBtn) {
      e.stopPropagation();
      removeDomainFromGroup(removeBtn.dataset.group, removeBtn.dataset.domain);
      return;
    }
    if (deleteBtn) {
      e.stopPropagation();
      if (confirm('Delete this group?')) deleteGroup(deleteBtn.dataset.group);
      return;
    }
    if (domainItem) {
      e.stopPropagation();
      renderDomainView(domainItem.dataset.domain);
      return;
    }
    if (groupHeader) {
      const groupEl = groupHeader.closest('.group-item');
      groupEl.classList.toggle('open');
    }
  });

  // Domain view
  document.getElementById('kw-search').addEventListener('input', e => {
    state.kwFilter = e.target.value;
    renderKeywordList();
  });
  document.getElementById('kw-sort').addEventListener('change', e => {
    state.kwSort = e.target.value;
    renderKeywordList();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Keyword list (delegation)
  document.getElementById('keyword-list').addEventListener('click', async e => {
    const pinBtn = e.target.closest('.kw-pin');
    const dismissBtn = e.target.closest('.kw-dismiss');
    if (pinBtn) {
      const kw = pinBtn.dataset.kw;
      const info = state.keywordData[state.activeDomainKey]?.keywords[kw];
      if (info) { info.pinned = !info.pinned; await saveKeywordData(); renderKeywordList(); }
    }
    if (dismissBtn) {
      const kw = dismissBtn.dataset.kw;
      const info = state.keywordData[state.activeDomainKey]?.keywords[kw];
      if (info) { info.dismissed = true; await saveKeywordData(); renderKeywordList(); }
    }
  });

  // Export buttons
  document.getElementById('btn-export-all').addEventListener('click', exportAll);
  document.getElementById('btn-export-domain').addEventListener('click', exportDomain);

  // Compare
  document.getElementById('btn-run-compare').addEventListener('click', runComparison);

  // Settings
  document.getElementById('setting-auto-appstore').addEventListener('change', saveSettings);
  document.getElementById('setting-min-freq').addEventListener('change', e => {
    state.settings.minFreq = parseInt(e.target.value) || 1;
    saveSettings();
    if (state.activeDomainKey) renderKeywordList();
  });
  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (confirm('Clear all keyword data and groups?')) {
      await msg('CLEAR_ALL');
      await loadData();
      renderAll();
      switchView('main');
    }
  });

  // Overlay click to close modals
  document.getElementById('overlay').addEventListener('click', () => {
    hideModal('modal-new-group');
    hideModal('modal-add-domain');
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function createGroup() {
  const name = document.getElementById('input-group-name').value.trim();
  if (!name) return;
  const group = { id: 'grp_' + Date.now(), name, domains: [], createdAt: Date.now() };
  await msg('SAVE_GROUP', { data: group });
  state.groups.push(group);
  hideModal('modal-new-group');
  document.getElementById('input-group-name').value = '';
  renderAll();
}

async function deleteGroup(groupId) {
  await msg('DELETE_GROUP', { groupId });
  state.groups = state.groups.filter(g => g.id !== groupId);
  renderAll();
}

async function removeDomainFromGroup(groupId, domain) {
  await msg('REMOVE_DOMAIN', { groupId, domain });
  const grp = state.groups.find(g => g.id === groupId);
  if (grp) grp.domains = (grp.domains || []).filter(d => d.domain !== domain);
  renderAll();
}

function showAddDomainModal() {
  const modal = document.getElementById('modal-add-domain');
  document.getElementById('modal-domain-name').textContent = state.currentDomain;
  const list = document.getElementById('group-select-list');
  list.innerHTML = state.groups.map(g => `
    <div class="group-select-item" data-group="${esc(g.id)}">
      <span>📁 ${esc(g.name)}</span>
    </div>`).join('');
  list.querySelectorAll('.group-select-item').forEach(item => {
    item.addEventListener('click', async () => {
      await msg('ADD_DOMAIN_TO_GROUP', {
        groupId: item.dataset.group,
        domain: state.currentDomain,
        pageType: state.currentPageType
      });
      const grp = state.groups.find(g => g.id === item.dataset.group);
      if (grp) {
        if (!grp.domains) grp.domains = [];
        // Remove from other groups
        state.groups.forEach(g => { if (g.id !== item.dataset.group) g.domains = (g.domains||[]).filter(d => d.domain !== state.currentDomain); });
        if (!grp.domains.find(d => d.domain === state.currentDomain)) {
          grp.domains.push({ domain: state.currentDomain, pageType: state.currentPageType, addedAt: Date.now() });
        }
      }
      hideModal('modal-add-domain');
      renderAll();
    });
  });
  showModal('modal-add-domain');
}

async function saveKeywordData() {
  await chrome.storage.local.set({ keywordData: state.keywordData });
}

async function saveSettings() {
  state.settings.autoAppStore = document.getElementById('setting-auto-appstore').checked;
  await chrome.storage.local.set({ settings: state.settings });
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportAll() {
  const rows = [['keyword','frequency','source_domain','source_fields','group']];
  for (const [domain, data] of Object.entries(state.keywordData)) {
    const group = state.groups.find(g => g.id === data.groupId);
    for (const [kw, info] of Object.entries(data.keywords || {})) {
      if (!info.dismissed) {
        rows.push([kw, info.frequency, domain, (info.sources||[]).join('|'), group?.name || '']);
      }
    }
  }
  downloadCSV(rows, 'keywordspy-all.csv');
}

function exportDomain() {
  const domainData = state.keywordData[state.activeDomainKey];
  if (!domainData) return;
  const group = state.groups.find(g => g.id === domainData.groupId);
  const rows = [['keyword','frequency','source_fields']];
  for (const [kw, info] of Object.entries(domainData.keywords || {})) {
    if (!info.dismissed) rows.push([kw, info.frequency, (info.sources||[]).join('|')]);
  }
  downloadCSV(rows, `keywordspy-${state.activeDomainKey}.csv`);
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewName).classList.add('active');
  state.activeView = viewName;
}

function showModal(id) {
  document.getElementById(id).style.display = 'flex';
  document.getElementById('overlay').style.display = 'block';
}

function hideModal(id) {
  document.getElementById(id).style.display = 'none';
  document.getElementById('overlay').style.display = 'none';
}

function isInAnyGroup(domain) {
  return state.groups.some(g => (g.domains || []).find(d => d.domain === domain));
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shortSource(src) {
  const map = {
    'app_name': 'name', 'subtitle': 'sub', 'description': 'desc',
    'description_short': 'desc↑', 'description_full': 'desc↓', 'description_ld': 'desc',
    'whats_new': 'new', 'iap_names': 'iap', 'category': 'cat', 'category_ld': 'cat',
    'page_title': 'title', 'meta_description': 'meta', 'meta_keywords': 'kws',
    'og_title': 'og:t', 'og_description': 'og:d', 'h1': 'h1', 'h2': 'h2', 'h3': 'h3',
    'body_copy': 'body', 'alt_text': 'alt', 'schema': 'ld+j', 'app_name_ld': 'name',
  };
  return map[src] || src.slice(0, 5);
}
