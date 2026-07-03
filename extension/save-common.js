// Shared helpers for popup + service worker (importScripts / <script> order)

function normalizeServerUrl(serverUrl) {
  return String(serverUrl || '').trim().replace(/\/+$/, '');
}

async function getStoredWriteToken() {
  try {
    const sync = await chrome.storage.sync.get(['writeToken']);
    return String(sync.writeToken || '').trim();
  } catch {
    return '';
  }
}

async function apiWriteHeaders(extraHeaders = {}) {
  const headers = { ...(extraHeaders || {}) };
  const token = await getStoredWriteToken();
  if (token) {
    headers['X-NextDash-Token'] = token;
  }
  return headers;
}

function isBookmarkableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const normalized = typeof BookmarkUrlUtils !== 'undefined'
      ? BookmarkUrlUtils.ensureHttpUrl(url)
      : ensureHttpUrl(url);
    const u = new URL(normalized);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function ensureHttpUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function fetchBookmarkExtras(serverUrl, url) {
  const base = normalizeServerUrl(serverUrl);
  const safeUrl = typeof BookmarkUrlUtils !== 'undefined'
    ? BookmarkUrlUtils.ensureHttpUrl(url)
    : ensureHttpUrl(url);
  if (!safeUrl || !isBookmarkableUrl(safeUrl)) return { url: safeUrl };

  const extras = { url: safeUrl };
  if (typeof BookmarkPreviewService === 'undefined') return extras;

  try {
    const icon = await BookmarkPreviewService.fetchAndUploadFavicon(safeUrl, base);
    if (icon) extras.icon = icon;
  } catch { /* optional */ }

  try {
    const preview = await BookmarkPreviewService.fetchLinkPreview(safeUrl, base);
    if (preview.title) extras.previewTitle = preview.title;
    if (preview.description) extras.previewDesc = preview.description;
    if (preview.image) extras.previewImage = preview.image;
  } catch { /* optional */ }

  return extras;
}

function normalizePagesData(pages) {
  const raw = Array.isArray(pages) ? pages : [];
  const list = raw
    .filter((page) => page && Number.isFinite(Number(page.id)) && Number(page.id) >= 1)
    .map((page) => ({
      ...page,
      id: Number(page.id),
      name: String(page.name || '').trim(),
    }));

  if (!list.some((page) => page.id === 1)) {
    list.unshift({ id: 1, name: 'main' });
  }
  if (list.length === 0) {
    return [{ id: 1, name: 'main' }];
  }
  list.forEach((page) => {
    if (!page.name) {
      page.name = page.id === 1 ? 'main' : `Page ${page.id}`;
    }
  });
  return list;
}

async function loadPagesList(serverUrl) {
  const base = normalizeServerUrl(serverUrl);
  const response = await fetch(new URL('/api/pages', base));
  if (!response.ok) throw new Error('pages');
  const pages = await response.json();
  return normalizePagesData(pages);
}

async function loadCategoriesList(serverUrl, pageId) {
  const base = normalizeServerUrl(serverUrl);
  const response = await fetch(new URL(`/api/categories?page=${pageId}`, base));
  if (!response.ok) throw new Error('categories');
  return response.json();
}

async function findDuplicateBookmark(serverUrl, pageId, bookmarkUrl) {
  const base = normalizeServerUrl(serverUrl);
  const response = await fetch(new URL(`/api/bookmarks?page=${pageId}`, base));
  if (!response.ok) return null;
  const bookmarks = await response.json();
  const key = typeof BookmarkUrlUtils !== 'undefined'
    ? BookmarkUrlUtils.canonicalBookmarkURLKey(bookmarkUrl)
    : String(bookmarkUrl || '').trim().toLowerCase();
  if (!key) return null;
  return bookmarks.find((b) => {
    const other = typeof BookmarkUrlUtils !== 'undefined'
      ? BookmarkUrlUtils.canonicalBookmarkURLKey(b.url)
      : String(b.url || '').trim().toLowerCase();
    return other === key;
  }) || null;
}

async function loadAllBookmarks(serverUrl) {
  const base = normalizeServerUrl(serverUrl);
  const response = await fetch(new URL('/api/bookmarks?all=true', base));
  if (!response.ok) return [];
  const bookmarks = await response.json();
  return Array.isArray(bookmarks) ? bookmarks : [];
}

function normalizeShortcutValue(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function collectUsedShortcuts(bookmarks) {
  const used = new Set();
  (bookmarks || []).forEach((bookmark) => {
    const shortcut = normalizeShortcutValue(bookmark?.shortcut);
    if (shortcut) used.add(shortcut);
  });
  return used;
}

function suggestBookmarkShortcut(name, bookmarks) {
  const used = collectUsedShortcuts(bookmarks);
  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    const shortcut = normalizeShortcutValue(value);
    if (!shortcut || seen.has(shortcut)) return;
    seen.add(shortcut);
    candidates.push(shortcut);
  };

  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const alnum = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let len = 1; len <= Math.min(5, alnum.length); len += 1) {
    addCandidate(alnum.slice(0, len));
  }
  if (words.length >= 2) {
    addCandidate(words.map((word) => word.replace(/[^a-zA-Z0-9]/g, '').charAt(0)).join(''));
  }

  for (const shortcut of candidates) {
    if (!used.has(shortcut)) return shortcut;
  }
  return '';
}

async function resolveBookmarkShortcut(serverUrl, name, explicitShortcut) {
  const normalized = normalizeShortcutValue(explicitShortcut);
  if (normalized) return normalized;
  const bookmarks = await loadAllBookmarks(serverUrl);
  return suggestBookmarkShortcut(name, bookmarks);
}

async function postAddBookmark(serverUrl, pageId, name, url, category, note, tags, extras = {}) {
  const base = normalizeServerUrl(serverUrl);
  const shortcut = await resolveBookmarkShortcut(serverUrl, name, extras.shortcut);
  const bookmark = {
    name,
    url,
    category: category || '',
    shortcut,
    checkStatus: false,
    note: note || '',
    tags: Array.isArray(tags) ? tags : [],
  };
  if (extras.icon) bookmark.icon = extras.icon;
  if (extras.previewTitle) bookmark.previewTitle = extras.previewTitle;
  if (extras.previewDesc) bookmark.previewDesc = extras.previewDesc;
  if (extras.previewImage) bookmark.previewImage = extras.previewImage;
  return fetch(new URL('/api/bookmarks/add', base), {
    method: 'POST',
    headers: await apiWriteHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      page: parseInt(pageId, 10),
      bookmark,
    })
  });
}

async function resolveSaveTarget(serverUrl, syncDefaults, lastCtx) {
  const pages = await loadPagesList(serverUrl);
  if (!pages.length) throw new Error('no_pages');
  const ids = new Set(pages.map((p) => String(p.id)));
  const norm = normalizeServerUrl(serverUrl);

  let pageId = '';
  if (lastCtx && normalizeServerUrl(lastCtx.serverUrl) === norm && lastCtx.pageId && ids.has(String(lastCtx.pageId))) {
    pageId = String(lastCtx.pageId);
  } else if (syncDefaults.defaultPage != null && String(syncDefaults.defaultPage) !== '' && ids.has(String(syncDefaults.defaultPage))) {
    pageId = String(syncDefaults.defaultPage);
  } else if (ids.has('1')) {
    pageId = '1';
  } else {
    pageId = String(pages[0].id);
  }

  let category = '';
  if (lastCtx && normalizeServerUrl(lastCtx.serverUrl) === norm && lastCtx.category !== undefined && lastCtx.category !== '') {
    category = lastCtx.category;
  } else if (syncDefaults.defaultCategory) {
    category = syncDefaults.defaultCategory;
  }

  const cats = await loadCategoriesList(serverUrl, pageId);
  const catIds = new Set(cats.map((c) => c.id));
  if (category && !catIds.has(category)) category = '';

  return { pageId, category };
}

async function persistLastSaveContext(serverUrl, pageId, category) {
  await chrome.storage.local.set({
    lastSaveContext: {
      serverUrl: normalizeServerUrl(serverUrl),
      pageId: String(pageId),
      category: category || ''
    }
  });
}

async function buildDashboardDeepLink(serverUrl, pageId) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) return `${base}/`;
  try {
    const pages = await loadPagesList(serverUrl);
    const idx = pages.findIndex((p) => String(p.id) === String(pageId));
    if (idx >= 0) {
      return `${base}/#${idx + 1}`;
    }
  } catch (e) {
    console.error('buildDashboardDeepLink:', e);
  }
  return `${base}/`;
}

/**
 * Notify open nextDash tabs (same server URL) so the dashboard can toast + refresh.
 */
async function notifyDashboardBookmarkSaved(serverUrl, pageId, bookmarkName, toastMessage) {
  const base = normalizeServerUrl(serverUrl);
  if (!base || typeof chrome.tabs?.query !== 'function' || typeof chrome.scripting?.executeScript !== 'function') {
    return;
  }
  const hash = await buildDashboardDeepLink(serverUrl, pageId);
  const message = toastMessage || (bookmarkName
    ? `"${String(bookmarkName).slice(0, 80)}" saved to nextDash`
    : 'Bookmark saved to nextDash');
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (e) {
    return;
  }
  const matching = tabs.filter((tab) => {
    if (!tab.id || !tab.url) return false;
    try {
      const tabOrigin = new URL(tab.url).origin;
      const serverOrigin = new URL(base).origin;
      return tabOrigin === serverOrigin && tab.url.startsWith(base);
    } catch {
      return false;
    }
  });
  const payload = { message, pageId: String(pageId), hash };
  await Promise.all(matching.map(async (tab) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (detail) => {
          window.dispatchEvent(new CustomEvent('nextdash:bookmark-saved', { detail }));
        },
        args: [payload]
      });
    } catch (e) {
      // Tab may not allow injection (chrome://, etc.)
    }
  }));
}
