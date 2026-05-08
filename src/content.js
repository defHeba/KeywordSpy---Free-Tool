// KeywordSpy Content Script
// Runs on every page, extracts keywords based on page type

(function () {
  'use strict';

  // ── Stopwords ────────────────────────────────────────────────────────────
  const STOPWORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'by','from','as','is','was','are','were','be','been','being','have',
    'has','had','do','does','did','will','would','could','should','may',
    'might','shall','can','need','dare','ought','used','it','its','this',
    'that','these','those','i','me','my','we','our','you','your','he','she',
    'they','them','their','what','which','who','whom','when','where','why',
    'how','all','both','each','few','more','most','other','some','such',
    'no','not','only','same','so','than','too','very','just','about',
    'above','after','before','between','into','through','during','including',
    'until','against','among','throughout','despite','towards','upon',
    'concerning','over','under','again','further','then','once','here',
    'there','now','any','get','also','if','up','out','use','new','one',
    'two','three','four','five','six','seven','eight','nine','ten','amp',
    'nbsp','www','com','http','https','true','false','null','undefined'
  ]);

  function getPageType() {
    const h = location.hostname;
    if (h === 'apps.apple.com') return 'appstore';
    if (h === 'play.google.com') return 'playstore';
    return 'website';
  }

  // For app store entries, use a stable normalized URL as the key
  // so each individual app is tracked separately.
  // For websites, key is just the hostname.
  function getTrackingKey(pageType) {
    if (pageType === 'appstore') {
      // apps.apple.com/us/app/myfitnesspal/id123456789
      // Normalize: strip locale, keep /app/{slug}/id{id}
      const match = location.pathname.match(/\/app\/([^/]+)\/(id\d+)/);
      if (match) return `apps.apple.com/app/${match[1]}/${match[2]}`;
      return `apps.apple.com${location.pathname}`;
    }
    if (pageType === 'playstore') {
      // play.google.com/store/apps/details?id=com.example.app
      const params = new URLSearchParams(location.search);
      const id = params.get('id');
      if (id) return `play.google.com/store/apps/details?id=${id}`;
      return `play.google.com${location.pathname}`;
    }
    return location.hostname;
  }

  function isAppStore() {
    return location.hostname === 'apps.apple.com';
  }

  function isPlayStore() {
    return location.hostname === 'play.google.com';
  }

  function tokenize(text, sourceLabel) {
    if (!text || typeof text !== 'string') return {};
    const tokens = text.toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, ' ')
      .split(/\s+/)
      .map(t => t.replace(/^-+|-+$/g, '').trim())
      .filter(t => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

    const freq = {};
    for (const token of tokens) {
      if (!freq[token]) freq[token] = { frequency: 0, sources: [] };
      freq[token].frequency++;
      if (!freq[token].sources.includes(sourceLabel)) {
        freq[token].sources.push(sourceLabel);
      }
    }
    return freq;
  }

  function mergeKeywords(...maps) {
    const merged = {};
    for (const map of maps) {
      for (const [kw, info] of Object.entries(map)) {
        if (!merged[kw]) merged[kw] = { frequency: 0, sources: [] };
        merged[kw].frequency += info.frequency;
        for (const src of info.sources) {
          if (!merged[kw].sources.includes(src)) merged[kw].sources.push(src);
        }
      }
    }
    return merged;
  }

  function extractText(selector, label) {
    const el = document.querySelector(selector);
    return el ? tokenize(el.textContent.trim(), label) : {};
  }

  function extractAllText(selector, label) {
    const els = document.querySelectorAll(selector);
    let combined = {};
    els.forEach(el => {
      combined = mergeKeywords(combined, tokenize(el.textContent.trim(), label));
    });
    return combined;
  }

  // ── App Store Extraction ─────────────────────────────────────────────────
  function extractAppStore() {
    const keywords = mergeKeywords(
      extractText('h1', 'app_name'),
      extractText('.product-hero__subtitle', 'subtitle'),
      extractText('[class*="subtitle"]', 'subtitle'),
      extractText('.we-truncate--multi-line', 'description_short'),
      extractText('.we-modal__body', 'description_full'),
      extractAllText('.we-truncate--multi-line, [itemprop="description"]', 'description'),
      extractText('[class*="version-history"] .we-truncate', 'whats_new'),
      extractAllText('.in-app-purchase-item__name, [class*="iap"] .name', 'iap_names'),
      extractText('[class*="genre"]', 'category'),
      extractText('[itemprop="applicationCategory"]', 'category')
    );

    // Try JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const d = JSON.parse(s.textContent);
        if (d.name) Object.assign(keywords, mergeKeywords(keywords, tokenize(d.name, 'app_name_ld')));
        if (d.description) Object.assign(keywords, mergeKeywords(keywords, tokenize(d.description, 'description_ld')));
        if (d.applicationCategory) Object.assign(keywords, mergeKeywords(keywords, tokenize(d.applicationCategory, 'category_ld')));
      } catch {}
    });

    const metadata = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
      canonical: document.querySelector('link[rel="canonical"]')?.href || location.href,
      schemaType: 'SoftwareApplication'
    };

    return { keywords, metadata };
  }

  // ── Website Extraction ───────────────────────────────────────────────────
  function extractWebsite() {
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    const metaKw = document.querySelector('meta[name="keywords"]')?.content || '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';

    // Body copy: prefer main/article, exclude nav/footer/aside/header
    let bodyText = '';
    const mainEl = document.querySelector('main, article, [role="main"], #main, .main-content, .content');
    if (mainEl) {
      const clone = mainEl.cloneNode(true);
      clone.querySelectorAll('nav,footer,aside,header,script,style,[class*="nav"],[class*="footer"],[class*="sidebar"],[class*="menu"],[class*="ad-"],[id*="ad-"]').forEach(el => el.remove());
      bodyText = clone.textContent;
    } else {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('nav,footer,aside,header,script,style').forEach(el => el.remove());
      bodyText = clone.textContent;
    }

    // Alt text
    const altTexts = Array.from(document.querySelectorAll('main img[alt], article img[alt], [role="main"] img[alt]'))
      .map(img => img.alt).filter(Boolean).join(' ');

    // Schema.org
    let schemaText = '';
    let schemaType = '';
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const d = JSON.parse(s.textContent);
        schemaType = d['@type'] || '';
        schemaText += ' ' + JSON.stringify(d);
      } catch {}
    });

    const keywords = mergeKeywords(
      tokenize(document.title, 'page_title'),
      tokenize(metaDesc, 'meta_description'),
      tokenize(metaKw, 'meta_keywords'),
      tokenize(ogTitle, 'og_title'),
      tokenize(ogDesc, 'og_description'),
      extractAllText('h1', 'h1'),
      extractAllText('h2', 'h2'),
      extractAllText('h3', 'h3'),
      tokenize(bodyText, 'body_copy'),
      tokenize(altTexts, 'alt_text'),
      tokenize(schemaText, 'schema')
    );

    const metadata = {
      title: document.title,
      description: metaDesc,
      keywords: metaKw,
      ogTitle,
      ogDescription: ogDesc,
      canonical: document.querySelector('link[rel="canonical"]')?.href || location.href,
      schemaType
    };

    return { keywords, metadata };
  }

  // ── Google Play Store Extraction ─────────────────────────────────────────
  function extractPlayStore() {
    const keywords = mergeKeywords(
      extractText('h1[itemprop="name"], h1', 'app_name'),
      extractText('[data-g-id="description"], [jsname="sngebd"]', 'description'),
      extractAllText('[itemprop="genre"], a[href*="category"]', 'category'),
      extractText('[class*="whatsNew"] div, [data-g-id="whats-new"] div', 'whats_new'),
      extractAllText('[class*="review"] [class*="content"]', 'reviews')
    );

    // JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const d = JSON.parse(s.textContent);
        if (d.name) Object.assign(keywords, mergeKeywords(keywords, tokenize(d.name, 'app_name_ld')));
        if (d.description) Object.assign(keywords, mergeKeywords(keywords, tokenize(d.description, 'description_ld')));
        if (d.applicationCategory) Object.assign(keywords, mergeKeywords(keywords, tokenize(d.applicationCategory, 'category_ld')));
      } catch {}
    });

    const metadata = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
      canonical: document.querySelector('link[rel="canonical"]')?.href || location.href,
      schemaType: 'SoftwareApplication (Play Store)'
    };

    return { keywords, metadata };
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  function run() {
    const pageType = getPageType();
    const trackingKey = getTrackingKey(pageType);

    // Only extract from actual app pages, not browse/category pages
    if (pageType === 'appstore' && !location.pathname.includes('/app/')) return;
    if (pageType === 'playstore' && !location.pathname.includes('/apps/details')) return;

    let extracted;
    if (pageType === 'appstore') extracted = extractAppStore();
    else if (pageType === 'playstore') extracted = extractPlayStore();
    else extracted = extractWebsite();

    const { keywords, metadata } = extracted;

    const topKeywords = Object.fromEntries(
      Object.entries(keywords)
        .filter(([, v]) => v.frequency >= 1)
        .sort(([, a], [, b]) => b.frequency - a.frequency)
        .slice(0, 500)
    );

    chrome.runtime.sendMessage({
      type: 'KEYWORDS_EXTRACTED',
      data: {
        domain: trackingKey,
        pageType,
        pageTitle: document.title,
        keywords: topKeywords,
        metadata
      }
    }).catch(() => {});
  }

  // Debounce for dynamic content
  let runTimer;
  function scheduleRun() {
    clearTimeout(runTimer);
    runTimer = setTimeout(run, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRun);
  } else {
    scheduleRun();
  }

  // Watch for SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleRun();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
