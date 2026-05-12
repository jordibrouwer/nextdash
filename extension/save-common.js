// Shared helpers for popup + service worker (importScripts / <script> order)

function normalizeServerUrl(serverUrl) {
  return String(serverUrl || '').trim().replace(/\/+$/, '');
}

function isBookmarkableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function loadPagesList(serverUrl) {
  const base = normalizeServerUrl(serverUrl);
  const response = await fetch(new URL('/api/pages', base));
  if (!response.ok) throw new Error('pages');
  return response.json();
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
  return bookmarks.find((b) => b.url === bookmarkUrl) || null;
}

async function postAddBookmark(serverUrl, pageId, name, url, category, note) {
  const base = normalizeServerUrl(serverUrl);
  return fetch(new URL('/api/bookmarks/add', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page: parseInt(pageId, 10),
      bookmark: {
        name,
        url,
        category: category || '',
        shortcut: '',
        checkStatus: false,
        note: note || ''
      }
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
