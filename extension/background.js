importScripts(
  'save-common.js',
  'i18n.js',
  'bookmark-form/bookmark-url-utils.js',
  'bookmark-form/bookmark-preview-service.js'
);

const BADGE_MS = 3500;

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, BADGE_MS);
}

async function installContextMenus() {
  await initExtensionI18nBackground();
  const savePageTitle = extT('contextMenuSavePage', 'Save page to nextDash');
  const saveLinkTitle = extT('contextMenuSaveLink', 'Save link to nextDash');
  const inboxPageTitle = extT('contextMenuInboxPage', 'Save page to nextDash Inbox');
  const inboxLinkTitle = extT('contextMenuInboxLink', 'Save link to nextDash Inbox');

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nextdash-save-page',
      title: savePageTitle,
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'nextdash-save-link',
      title: saveLinkTitle,
      contexts: ['link']
    });
    // The popup has had a Save to Inbox button all along, while the two routes
    // that exist to avoid the popup — the shortcut and this menu — could only
    // ever make a bookmark on a page. Right-clicking a link is the most common
    // capture gesture there is, and it was the one that could not reach the
    // inbox.
    chrome.contextMenus.create({
      id: 'nextdash-inbox-page',
      title: inboxPageTitle,
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'nextdash-inbox-link',
      title: inboxLinkTitle,
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.extensionLocale) {
    installContextMenus();
  }
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

  const extras = await fetchBookmarkExtras(serverUrl, url);
  const saveUrl = extras.url || url;

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

  const dup = await findDuplicateBookmark(serverUrl, pageId, saveUrl);
  if (dup) {
    flashBadge('D', '#FFD600');
    return { ok: false, reason: 'duplicate' };
  }

    try {
    const { icon, previewTitle, previewDesc, previewImage } = extras;
    const res = await postAddBookmark(serverUrl, pageId, name, saveUrl, category, '', [], {
      icon,
      previewTitle,
      previewDesc,
      previewImage,
    });
    if (!res.ok) {
      flashBadge('!', '#FF0055');
      return { ok: false, reason: 'http' };
    }
    await persistLastSaveContext(serverUrl, pageId, category);
    await notifyDashboardBookmarkSaved(serverUrl, pageId, name);
    flashBadge('+', '#00FF9C');
    return { ok: true };
  } catch (e) {
    console.error('nextDash quick save POST:', e);
    flashBadge('!', '#FF0055');
    return { ok: false, reason: 'network' };
  }
}

/**
 * Save a URL straight to the inbox, with the same badge vocabulary the bookmark
 * path uses: + saved, D duplicate, ? no server, ! failed.
 *
 * No page, no category, no duplicate lookup against a page — the inbox is the
 * place for a link you have not decided about yet, and the server refuses a URL
 * it already holds.
 */
async function quickSaveToInbox(title, url) {
  const { serverUrl } = await chrome.storage.sync.get(['serverUrl']);
  if (!serverUrl) {
    flashBadge('?', '#FFD600');
    return { ok: false, reason: 'no_server' };
  }
  if (!isBookmarkableUrl(url)) {
    flashBadge('×', '#FF0055');
    return { ok: false, reason: 'bad_url' };
  }
  try {
    const res = await postInboxLink(serverUrl, url, { title: title || '', source: 'extension' });
    if (res.status === 409) {
      // The URL is already in the inbox: not a failure, and not something to
      // report as one.
      flashBadge('D', '#FFD600');
      return { ok: false, reason: 'duplicate' };
    }
    if (!res.ok) {
      flashBadge('!', '#FF0055');
      return { ok: false, reason: 'http' };
    }
    flashBadge('+', '#00FF9C');
    return { ok: true };
  } catch (e) {
    console.error('nextDash inbox save:', e);
    flashBadge('!', '#FF0055');
    return { ok: false, reason: 'network' };
  }
}

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url) return;
    const title = tab.title || tab.url;
    if (command === 'quick-save') {
      quickSaveBookmark(title, tab.url);
      return;
    }
    if (command === 'quick-save-inbox') {
      quickSaveToInbox(title, tab.url);
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'nextdash-inbox-link' && info.linkUrl) {
    const name = (info.linkText && String(info.linkText).trim()) || info.linkUrl;
    quickSaveToInbox(name.slice(0, 500), info.linkUrl);
    return;
  }
  if (info.menuItemId === 'nextdash-inbox-page' && tab?.url) {
    quickSaveToInbox(tab.title || tab.url, tab.url);
    return;
  }
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
