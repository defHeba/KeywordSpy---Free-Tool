// KeywordSpy Background Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'KEYWORDS_EXTRACTED') {
    handleKeywordsExtracted(message.data, sender.tab).then(sendResponse);
    return true; // async
  }
  if (message.type === 'GET_ALL_DATA') {
    getAllData().then(sendResponse);
    return true;
  }
  if (message.type === 'SAVE_GROUP') {
    saveGroup(message.data).then(sendResponse);
    return true;
  }
  if (message.type === 'DELETE_GROUP') {
    deleteGroup(message.groupId).then(sendResponse);
    return true;
  }
  if (message.type === 'ADD_DOMAIN_TO_GROUP') {
    addDomainToGroup(message.groupId, message.domain, message.pageType).then(sendResponse);
    return true;
  }
  if (message.type === 'REMOVE_DOMAIN') {
    removeDomain(message.groupId, message.domain).then(sendResponse);
    return true;
  }
  if (message.type === 'CLEAR_ALL') {
    clearAll().then(sendResponse);
    return true;
  }
  if (message.type === 'GET_CURRENT_TAB_INFO') {
    getCurrentTabDomain(sender.tab).then(sendResponse);
    return true;
  }
});

async function handleKeywordsExtracted(data, tab) {
  const { domain, keywords, metadata, pageType, pageTitle } = data;
  const storage = await chrome.storage.local.get(['keywordData', 'groups']);
  const keywordData = storage.keywordData || {};
  const groups = storage.groups || [];

  // Find which group this domain belongs to
  let groupId = null;
  for (const g of groups) {
    if (g.domains && g.domains.find(d => d.domain === domain)) {
      groupId = g.id;
      break;
    }
  }

  if (!keywordData[domain]) {
    keywordData[domain] = {
      domain,
      pageType,
      keywords: {},
      metadata: [],
      pagesCaptures: [],
      totalPages: 0,
      lastCaptured: null,
      groupId
    };
  }

  // Merge keywords
  for (const [kw, info] of Object.entries(keywords)) {
    if (!keywordData[domain].keywords[kw]) {
      keywordData[domain].keywords[kw] = { frequency: 0, sources: [], firstSeen: Date.now(), pinned: false, tags: [], dismissed: false };
    }
    keywordData[domain].keywords[kw].frequency += info.frequency;
    for (const src of info.sources) {
      if (!keywordData[domain].keywords[kw].sources.includes(src)) {
        keywordData[domain].keywords[kw].sources.push(src);
      }
    }
  }

  // Store metadata
  if (metadata) {
    keywordData[domain].metadata.push({ ...metadata, pageTitle, timestamp: Date.now() });
    if (keywordData[domain].metadata.length > 20) keywordData[domain].metadata = keywordData[domain].metadata.slice(-20);
  }

  const url = tab ? tab.url : '';
  if (!keywordData[domain].pagesCaptures.includes(url)) {
    keywordData[domain].pagesCaptures.push(url);
    keywordData[domain].totalPages++;
  }
  keywordData[domain].lastCaptured = Date.now();
  keywordData[domain].pageType = pageType;
  keywordData[domain].groupId = groupId;

  await chrome.storage.local.set({ keywordData });
  return { success: true };
}

async function getAllData() {
  const storage = await chrome.storage.local.get(['keywordData', 'groups']);
  return {
    keywordData: storage.keywordData || {},
    groups: storage.groups || []
  };
}

async function saveGroup(group) {
  const storage = await chrome.storage.local.get('groups');
  let groups = storage.groups || [];
  const idx = groups.findIndex(g => g.id === group.id);
  if (idx >= 0) groups[idx] = group;
  else groups.push(group);
  await chrome.storage.local.set({ groups });
  return { success: true };
}

async function deleteGroup(groupId) {
  const storage = await chrome.storage.local.get(['groups', 'keywordData']);
  let groups = storage.groups || [];
  const keywordData = storage.keywordData || {};
  groups = groups.filter(g => g.id !== groupId);
  // Unassign domains from deleted group
  for (const domain of Object.keys(keywordData)) {
    if (keywordData[domain].groupId === groupId) {
      keywordData[domain].groupId = null;
    }
  }
  await chrome.storage.local.set({ groups, keywordData });
  return { success: true };
}

async function addDomainToGroup(groupId, domain, pageType) {
  const storage = await chrome.storage.local.get(['groups', 'keywordData']);
  let groups = storage.groups || [];
  const keywordData = storage.keywordData || {};

  // Remove from any existing group
  for (const g of groups) {
    if (g.domains) g.domains = g.domains.filter(d => d.domain !== domain);
  }

  const grp = groups.find(g => g.id === groupId);
  if (grp) {
    if (!grp.domains) grp.domains = [];
    grp.domains.push({ domain, pageType, addedAt: Date.now() });
  }

  if (keywordData[domain]) keywordData[domain].groupId = groupId;

  await chrome.storage.local.set({ groups, keywordData });
  return { success: true };
}

async function removeDomain(groupId, domain) {
  const storage = await chrome.storage.local.get(['groups', 'keywordData']);
  let groups = storage.groups || [];
  const keywordData = storage.keywordData || {};

  const grp = groups.find(g => g.id === groupId);
  if (grp && grp.domains) grp.domains = grp.domains.filter(d => d.domain !== domain);
  if (keywordData[domain]) keywordData[domain].groupId = null;

  await chrome.storage.local.set({ groups, keywordData });
  return { success: true };
}

async function clearAll() {
  await chrome.storage.local.set({ keywordData: {}, groups: [] });
  return { success: true };
}

async function getCurrentTabDomain(tab) {
  if (!tab || !tab.url) return { domain: null };
  try {
    const url = new URL(tab.url);
    return { domain: url.hostname, fullUrl: tab.url };
  } catch {
    return { domain: null };
  }
}
