importScripts('save-common.js');

const BADGE_MS = 3500;

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, BADGE_MS);
}

function installContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nextdash-save-page',
      title: 'Save page to nextDash',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'nextdash-save-link',
      title: 'Save link to nextDash',
      contexts: ['link']
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  installContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  installContextMenus();
});

async function quickSaveBookmark(name, url) {
  const sync = await chrome.storage.sync.get(['serverUrl', 'defaultPage', 'defaultCategory']);
  const serverUrl = sync.serverUrl;
  if (!serverUrl) {
    flashBadge('?', '#FFD600');
    return { ok: false, reason: 'no_server' };
  }
  if (!isBookmarkableUrl(url)) {
    flashBadge('×', '#FF0055');
    return { ok: false, reason: 'bad_url' };
  }

  const { lastSaveContext } = await chrome.storage.local.get('lastSaveContext');

  let pageId;
  let category;
  try {
    const resolved = await resolveSaveTarget(serverUrl, sync, lastSaveContext || null);
    pageId = resolved.pageId;
    category = resolved.category;
  } catch (e) {
    console.error('nextDash quick save:', e);
    flashBadge('!', '#FF0055');
    return { ok: false, reason: 'resolve' };
  }

  const dup = await findDuplicateBookmark(serverUrl, pageId, url);
  if (dup) {
    flashBadge('D', '#FFD600');
    return { ok: false, reason: 'duplicate' };
  }

    try {
    const res = await postAddBookmark(serverUrl, pageId, name, url, category, '');
    if (!res.ok) {
      flashBadge('!', '#FF0055');
      return { ok: false, reason: 'http' };
    }
    await persistLastSaveContext(serverUrl, pageId, category);
    flashBadge('+', '#00FF9C');
    return { ok: true };
  } catch (e) {
    console.error('nextDash quick save POST:', e);
    flashBadge('!', '#FF0055');
    return { ok: false, reason: 'network' };
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'quick-save') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url) return;
    const title = tab.title || tab.url;
    quickSaveBookmark(title, tab.url);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'nextdash-save-link' && info.linkUrl) {
    const name = (info.linkText && String(info.linkText).trim()) || info.linkUrl;
    quickSaveBookmark(name.slice(0, 500), info.linkUrl);
    return;
  }
  if (info.menuItemId === 'nextdash-save-page' && tab?.url) {
    const title = tab.title || tab.url;
    quickSaveBookmark(title, tab.url);
  }
});
