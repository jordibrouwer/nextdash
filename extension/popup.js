// nextDash Bookmark Saver Extension

let confirmationCallback = null;
let extDraftState = { icon: '', previewTitle: '', previewDesc: '', previewImage: '' };
// Set once the "already saved elsewhere" message has been shown, so pressing
// save again means "yes, a second copy". Cleared on a successful save and
// whenever the popup's draft is reset.
let extDuplicateAcknowledged = false;
let extFormPreview = null;
let extServerUrl = '';
let extPageBookmarks = [];
let extAllowDuplicateUrls = false;

function getExtDraftBookmark() {
    return {
        name: document.getElementById('bookmark-name')?.value || '',
        url: document.getElementById('bookmark-url')?.value || '',
        shortcut: document.getElementById('bookmark-shortcut')?.value || '',
        note: document.getElementById('bookmark-note')?.value || '',
        icon: extDraftState.icon || '',
        pinned: false,
        checkStatus: false,
        previewTitle: extDraftState.previewTitle || '',
        previewDesc: extDraftState.previewDesc || '',
        previewImage: extDraftState.previewImage || '',
    };
}

function initExtensionPreview() {
    if (!window.BookmarkFormPreview) return;
    extFormPreview = new window.BookmarkFormPreview({
        prefix: 'ext',
        apiBase: extServerUrl,
        iconBasePath: extServerUrl ? `${extServerUrl.replace(/\/+$/, '')}/data/icons/` : '/data/icons/',
        getSettings: () => ({}),
        t: (key, fb) => {
            const short = key.replace(/^config\./, '');
            const extKeyMap = {
                bookmarkDashboardPreviewLabel: 'previewDashboardLabel',
                bookmarkDashboardPreviewHint: 'previewDashboardHint',
                bookmarkDashboardPreviewAria: 'previewDashboardAria',
                bookmarkLinkPreviewLabel: 'previewLinkLabel',
                bookmarkLinkPreviewRefresh: 'previewRefresh',
                bookmarkLinkPreviewClear: 'previewClear',
                bookmarkLinkPreviewEmpty: 'previewEmpty',
                bookmarkLinkPreviewNoUrl: 'previewNoUrl',
                bookmarkLinkPreviewRefreshed: 'previewRefreshed',
                bookmarkLinkPreviewRefreshFailed: 'previewRefreshFailed',
                bookmarkLinkPreviewCleared: 'previewCleared',
                bookmarkPreviewUntitled: 'previewUntitled',
                bookmarkPreviewStatusCheck: 'previewStatusCheck',
            };
            const extKey = extKeyMap[short];
            return extKey ? extT(extKey, fb) : fb;
        },
        notify: (msg, type) => showMessage(msg, type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'),
        onPreviewChange: (bookmark) => {
            extDraftState.previewTitle = bookmark.previewTitle || '';
            extDraftState.previewDesc = bookmark.previewDesc || '';
            extDraftState.previewImage = bookmark.previewImage || '';
        },
    });
    extFormPreview.getBookmark = () => getExtDraftBookmark();
    extFormPreview.bind();

    document.getElementById('ext-link-preview-refresh-btn')?.addEventListener('click', async () => {
        const bookmark = getExtDraftBookmark();
        const urlInput = document.getElementById('bookmark-url');
        if (urlInput) {
            bookmark.url = BookmarkUrlUtils.ensureHttpUrl(urlInput.value);
            urlInput.value = bookmark.url;
        }
        await extFormPreview.refreshLinkPreview(bookmark);
        extDraftState.previewTitle = bookmark.previewTitle || '';
        extDraftState.previewDesc = bookmark.previewDesc || '';
        extDraftState.previewImage = bookmark.previewImage || '';
        extFormPreview.updateAll(bookmark);
    });

    document.getElementById('ext-link-preview-clear-btn')?.addEventListener('click', () => {
        const bookmark = getExtDraftBookmark();
        extFormPreview.clearLinkPreview(bookmark);
        extDraftState.previewTitle = '';
        extDraftState.previewDesc = '';
        extDraftState.previewImage = '';
        extFormPreview.updateAll(bookmark);
    });
}

async function scheduleExtensionUrlMeta() {
    BookmarkPreviewService.scheduleDebounced('ext-url-meta', async () => {
        await autoFetchExtensionUrlMeta();
    }, 450);
}

async function autoFetchExtensionUrlMeta() {
    const urlInput = document.getElementById('bookmark-url');
    const nameInput = document.getElementById('bookmark-name');
    if (!urlInput || !extServerUrl) return;

    const normalized = BookmarkUrlUtils.ensureHttpUrl(urlInput.value);
    if (!normalized || !isBookmarkableUrl(normalized)) {
        extFormPreview?.updateAll(getExtDraftBookmark());
        return;
    }
    if (normalized !== urlInput.value.trim()) urlInput.value = normalized;
    updateUrlGuard(normalized);

    try {
        const extras = await fetchBookmarkExtras(extServerUrl, normalized);
        if (extras.icon) extDraftState.icon = extras.icon;
        if (extras.previewTitle) extDraftState.previewTitle = extras.previewTitle;
        if (extras.previewDesc) extDraftState.previewDesc = extras.previewDesc;
        if (extras.previewImage) extDraftState.previewImage = extras.previewImage;
        if (!String(nameInput?.value || '').trim() && extras.previewTitle) {
            nameInput.value = extras.previewTitle;
        }
    } catch { /* optional */ }

    extFormPreview?.updateAll(getExtDraftBookmark());
}

// One shared #message element, so one shared timer: an earlier message's
// timeout used to hide whatever was on screen when it fired, wiping a "saved"
// confirmation that had only just replaced an error.
let messageHideTimer = null;

function showMessage(text, type = 'info') {
    const messageEl = document.getElementById('message');
    if (messageHideTimer) {
        clearTimeout(messageHideTimer);
        messageHideTimer = null;
    }
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';

    // Auto-hide after 5 seconds for success/error, keep for info
    if (type !== 'info') {
        messageHideTimer = setTimeout(() => {
            messageHideTimer = null;
            messageEl.style.display = 'none';
        }, 5000);
    }
}

function hideMessage() {
    if (messageHideTimer) {
        clearTimeout(messageHideTimer);
        messageHideTimer = null;
    }
    document.getElementById('message').style.display = 'none';
}

function updateUrlGuard(url) {
    const msg = document.getElementById('url-guard-msg');
    const form = document.getElementById('save-form');
    if (!msg || !form) return;
    const ok = isBookmarkableUrl(url);
    if (ok) {
        msg.classList.add('hidden');
        msg.textContent = '';
        form.classList.remove('save-form-disabled');
    } else {
        msg.classList.remove('hidden');
        msg.textContent = extT('urlGuardInvalid', msg.textContent);
        form.classList.add('save-form-disabled');
    }
}

function findDuplicateBookmarkOnPage(url) {
    const key = BookmarkUrlUtils.canonicalBookmarkURLKey(url);
    if (!key) return null;
    return extPageBookmarks.find(
        (bookmark) => BookmarkUrlUtils.canonicalBookmarkURLKey(bookmark.url) === key
    ) || null;
}

function hasUrlDuplicateOnPage(url) {
    return Boolean(findDuplicateBookmarkOnPage(url));
}

async function loadExtensionPreferences() {
    try {
        const sync = await chrome.storage.sync.get(['extensionAllowDuplicateUrls']);
        extAllowDuplicateUrls = Boolean(sync.extensionAllowDuplicateUrls);
    } catch {
        extAllowDuplicateUrls = false;
    }
    const allowCheckbox = document.getElementById('extension-allow-duplicate-urls');
    if (allowCheckbox) allowCheckbox.checked = extAllowDuplicateUrls;
}

function updateUrlDuplicateHint() {
    const urlInput = document.getElementById('bookmark-url');
    const panel = document.getElementById('bookmark-url-duplicate-panel');
    const textEl = document.getElementById('bookmark-url-duplicate-text');
    const saveAnywayBtn = document.getElementById('bookmark-url-save-anyway');
    if (!urlInput || !panel || !textEl) return;

    const raw = String(urlInput.value || '').trim();
    if (!raw) {
        panel.hidden = true;
        if (saveAnywayBtn) saveAnywayBtn.hidden = true;
        urlInput.classList.remove('field-conflict');
        return;
    }

    const normalized = BookmarkUrlUtils.ensureHttpUrl(raw);
    const duplicateBookmark = isBookmarkableUrl(normalized)
        ? findDuplicateBookmarkOnPage(normalized)
        : null;
    const duplicate = Boolean(duplicateBookmark);

    if (!duplicate || extAllowDuplicateUrls) {
        panel.hidden = true;
        if (saveAnywayBtn) saveAnywayBtn.hidden = true;
        urlInput.classList.remove('field-conflict');
        return;
    }

    panel.hidden = false;
    urlInput.classList.add('field-conflict');
    if (duplicateBookmark.name) {
        textEl.textContent = extT(
            'urlConflictExisting',
            'This URL already exists on this page as "{name}".',
            { name: duplicateBookmark.name }
        );
    } else {
        textEl.textContent = extT('urlConflictHint', 'This URL already exists on this page.');
    }
    if (saveAnywayBtn) saveAnywayBtn.hidden = false;
}

async function refreshPageBookmarks() {
    const settings = await chrome.storage.sync.get(['serverUrl']);
    const serverUrl = settings.serverUrl;
    const pageId = document.getElementById('page-select')?.value;

    if (!serverUrl || !pageId) {
        extPageBookmarks = [];
        updateUrlDuplicateHint();
        return;
    }

    try {
        const response = await fetch(new URL(`/api/bookmarks?page=${pageId}`, serverUrl));
        extPageBookmarks = response.ok ? await response.json() : [];
    } catch (error) {
        console.error('Error loading bookmarks for duplicate check:', error);
        extPageBookmarks = [];
    }

    updateUrlDuplicateHint();
}

function showConfirmation(text, onYes) {
    document.getElementById('confirmation-text').innerHTML = text;
    document.getElementById('confirmation').classList.remove('hidden');
    confirmationCallback = onYes;
    
    // Add click outside to close
    document.getElementById('confirmation').addEventListener('click', handleConfirmationClick);
}

function hideConfirmation() {
    document.getElementById('confirmation').classList.add('hidden');
    document.getElementById('confirmation').removeEventListener('click', handleConfirmationClick);
    confirmationCallback = null;
}

function handleConfirmationClick(event) {
    if (event.target.id === 'confirmation') {
        hideConfirmation();
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    await initExtensionI18n();
    await loadExtensionPreferences();

    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;

            // Update active tab button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update active tab content
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(tabName + '-tab').classList.add('active');

            // Load data for the tab
            hideMessage();
            if (tabName === 'save') {
                loadSaveTab();
            } else if (tabName === 'settings') {
                loadSettingsTab();
            }
        });
    });

    // Load initial data
    loadSettings();
    loadSaveTab();

    // Save form
    document.getElementById('save-form').addEventListener('submit', saveBookmark);
    document.getElementById('save-inbox-btn')?.addEventListener('click', () => {
        void saveToInbox();
    });

    document.getElementById('bookmark-url').addEventListener('input', (e) => {
        updateUrlGuard(e.target.value);
        updateUrlDuplicateHint();
        scheduleExtensionUrlMeta();
    });

    document.getElementById('bookmark-url').addEventListener('blur', (e) => {
        const normalized = BookmarkUrlUtils.ensureHttpUrl(e.target.value);
        if (normalized && normalized !== e.target.value.trim()) {
            e.target.value = normalized;
            updateUrlGuard(normalized);
        }
        updateUrlDuplicateHint();
        void autoFetchExtensionUrlMeta();
    });

    document.getElementById('bookmark-name')?.addEventListener('input', () => {
        extFormPreview?.updateAll(getExtDraftBookmark());
    });

    document.getElementById('bookmark-shortcut')?.addEventListener('input', (event) => {
        const input = event.target;
        const normalized = typeof normalizeShortcutValue === 'function'
            ? normalizeShortcutValue(input.value)
            : String(input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (input.value !== normalized) input.value = normalized;
    });

    document.getElementById('bookmark-url-save-anyway')?.addEventListener('click', () => {
        void saveBookmarkAnyway();
    });

    // Page select change to load categories
    document.getElementById('page-select').addEventListener('change', async (event) => {
        const pageId = event.target.value;
        if (pageId) {
            await loadCategories(pageId);
            await refreshPageBookmarks();
        } else {
            extPageBookmarks = [];
            updateUrlDuplicateHint();
        }
    });

    // Default page select change to load categories for settings
    document.getElementById('default-page').addEventListener('change', async (event) => {
        const pageId = event.target.value;
        if (pageId) {
            await loadCategoriesForSettings(pageId);
        }
    });

    // Settings form
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    
    // Reload pages button
    document.getElementById('reload-pages-btn').addEventListener('click', async () => {
        const serverUrl = document.getElementById('server-url').value;
        await loadPages(serverUrl);
    });
    
    // Reset settings button
    document.getElementById('reset-settings-btn').addEventListener('click', resetSettings);
    
    // Confirmation buttons
    document.getElementById('confirm-yes').addEventListener('click', async () => {
        if (confirmationCallback) {
            await confirmationCallback();
        }
        hideConfirmation();
    });
    
    document.getElementById('confirm-no').addEventListener('click', () => {
        hideConfirmation();
    });
});

async function loadSettings() {
    const settings = await chrome.storage.sync.get([
        'serverUrl',
        'defaultPage',
        'defaultCategory',
        'extensionAllowDuplicateUrls',
        'writeToken',
    ]);
    document.getElementById('server-url').value = settings.serverUrl || '';
    const writeTokenInput = document.getElementById('write-token');
    if (writeTokenInput) writeTokenInput.value = settings.writeToken || '';
    extAllowDuplicateUrls = Boolean(settings.extensionAllowDuplicateUrls);
    const allowCheckbox = document.getElementById('extension-allow-duplicate-urls');
    if (allowCheckbox) allowCheckbox.checked = extAllowDuplicateUrls;
}

async function loadSaveTab() {
    try {
        const settings = await chrome.storage.sync.get(['serverUrl']);
        extServerUrl = settings.serverUrl || '';
        if (!extFormPreview) initExtensionPreview();

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        document.getElementById('bookmark-name').value = tab.title || '';
        document.getElementById('bookmark-url').value = tab.url || '';
        extDraftState = { icon: '', previewTitle: '', previewDesc: '', previewImage: '' };
        extDuplicateAcknowledged = false;
        updateUrlGuard(tab.url || '');
        await loadPages();
        void autoFetchExtensionUrlMeta();
    } catch (error) {
        console.error('Error loading save tab:', error);
    }
}

async function loadPages(providedServerUrl) {
    let serverUrl = providedServerUrl;
    if (!serverUrl) {
        const settings = await chrome.storage.sync.get(['serverUrl']);
        serverUrl = settings.serverUrl;
    }

    if (!serverUrl) {
        showMessage(extT('msgSetServerUrl', 'Please set the nextDash URL in settings first.'), 'info');
        return;
    }
    extServerUrl = serverUrl;
    if (!extFormPreview) initExtensionPreview();

    try {
        const response = await fetch(new URL('/api/pages', serverUrl));
        if (!response.ok) throw new Error('Failed to fetch pages');

        const pages = normalizePagesData(await response.json());
        if (!pages.length) {
            showMessage(extT('msgNoPages', 'No pages returned from server.'), 'error');
            return;
        }

        const pageSelect = document.getElementById('page-select');
        const defaultPageSelect = document.getElementById('default-page');

        pageSelect.innerHTML = '';
        defaultPageSelect.innerHTML = '';

        pages.forEach((page) => {
            pageSelect.appendChild(new Option(page.name, page.id));
            defaultPageSelect.appendChild(new Option(page.name, page.id));
        });

        const defaultSettings = await chrome.storage.sync.get(['defaultPage', 'defaultCategory']);
        const localCtx = await chrome.storage.local.get('lastSaveContext');
        const pageIds = new Set(pages.map((p) => String(p.id)));

        const syncDefaults = {
            defaultPage: defaultSettings.defaultPage,
            defaultCategory: defaultSettings.defaultCategory || ''
        };

        const defPage =
            defaultSettings.defaultPage != null && pageIds.has(String(defaultSettings.defaultPage))
                ? String(defaultSettings.defaultPage)
                : pageIds.has('1')
                    ? '1'
                    : String(pages[0].id);
        defaultPageSelect.value = defPage;

        let savePageId = defPage;
        let saveCategory = syncDefaults.defaultCategory || '';
        try {
            const r = await resolveSaveTarget(serverUrl, syncDefaults, localCtx.lastSaveContext || null);
            savePageId = r.pageId;
            saveCategory = r.category || '';
        } catch (e) {
            console.error('resolveSaveTarget:', e);
        }

        pageSelect.value = savePageId;
        await loadCategories(savePageId);
        await refreshPageBookmarks();
        const catSelect = document.getElementById('category-select');
        if (saveCategory && [...catSelect.options].some((o) => o.value === saveCategory)) {
            catSelect.value = saveCategory;
        }

        hideMessage();
    } catch (error) {
        console.error('Error loading pages:', error);
        showMessage(extT('msgFailedPages', 'Failed to load pages. Check your server URL.'), 'error');
    }
}

async function loadSettingsTab() {
    // Pages are loaded manually via the reload button, but we can load if already configured
    const settings = await chrome.storage.sync.get(['serverUrl']);
    if (settings.serverUrl) {
        await loadPages();
        const defaultSettings = await chrome.storage.sync.get(['defaultPage', 'defaultCategory']);
        if (defaultSettings.defaultPage) {
            await loadCategoriesForSettings(defaultSettings.defaultPage);
            if (defaultSettings.defaultCategory) {
                document.getElementById('default-category').value = defaultSettings.defaultCategory;
            }
        }
    }
}

async function loadCategoriesForSettings(pageId) {
    const settings = await chrome.storage.sync.get(['serverUrl']);
    const serverUrl = settings.serverUrl;

    if (!serverUrl) {
        return;
    }

    try {
        const response = await fetch(new URL(`/api/categories?page=${pageId}`, serverUrl));
        if (!response.ok) throw new Error('Failed to fetch categories');

        const categories = await response.json();
        const categorySelect = document.getElementById('default-category');

        // Clear existing options
        categorySelect.innerHTML = '';

        // Add default empty option
        const defaultOption = new Option(extT('noCategory', 'No Category'), '');
        categorySelect.appendChild(defaultOption);

        categories.forEach(category => {
            const option = new Option(category.name, category.id);
            categorySelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading categories for settings:', error);
    }
}

async function loadCategories(pageId) {
    const settings = await chrome.storage.sync.get(['serverUrl']);
    const serverUrl = settings.serverUrl;

    if (!serverUrl) {
        return; // No server URL, can't load
    }

    try {
        const response = await fetch(new URL(`/api/categories?page=${pageId}`, serverUrl));
        if (!response.ok) throw new Error('Failed to fetch categories');

        const categories = await response.json();
        const categorySelect = document.getElementById('category-select');

        // Clear existing options
        categorySelect.innerHTML = '';

        // Add default empty option
        const defaultOption = new Option(extT('noCategory', 'No Category'), '');
        categorySelect.appendChild(defaultOption);

        categories.forEach(category => {
            const option = new Option(category.name, category.id);
            categorySelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading categories:', error);
        // Don't show error message, just leave empty
    }
}

function collectSaveFormData() {
    const serverUrl = extServerUrl
        || document.getElementById('server-url')?.value?.trim()
        || '';
    const name = document.getElementById('bookmark-name')?.value || '';
    const rawUrl = document.getElementById('bookmark-url')?.value || '';
    const url = BookmarkUrlUtils.ensureHttpUrl(rawUrl);
    const pageId = document.getElementById('page-select')?.value || '';
    const category = document.getElementById('category-select')?.value || '';
    const note = document.getElementById('bookmark-note')?.value || '';
    const tagsRaw = document.getElementById('bookmark-tags')?.value || '';
    const tags = tagsRaw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const shortcut = document.getElementById('bookmark-shortcut')?.value || '';
    return { serverUrl, name, url, pageId, category, note, tags, shortcut };
}

async function saveBookmark(event, options = {}) {
    if (event) event.preventDefault();

    const data = collectSaveFormData();
    if (!data.serverUrl) {
        showMessage(extT('msgSetServerUrl', 'Please set the nextDash URL in settings first.'), 'error');
        return;
    }

    if (!isBookmarkableUrl(data.url)) {
        showMessage(extT('msgUrlNotSavable', 'This URL cannot be saved. Use a normal http(s) page.'), 'error');
        return;
    }

    const allowDuplicate = options.allowDuplicate === true || extAllowDuplicateUrls;

    if (!allowDuplicate) {
        await refreshPageBookmarks();
        if (hasUrlDuplicateOnPage(data.url)) {
            updateUrlDuplicateHint();
            showMessage(extT('msgDuplicateBookmarkUrl', 'This URL already exists on this page.'), 'error');
            return;
        }
    }

    await performSave(
        data.serverUrl,
        data.pageId,
        data.name,
        data.url,
        data.category,
        data.note,
        data.tags,
        data.shortcut
    );
}

async function saveToInbox() {
    const data = collectSaveFormData();
    if (!data.serverUrl) {
        showMessage(extT('msgSetServerUrl', 'Please set the nextDash URL in settings first.'), 'error');
        return;
    }
    if (!isBookmarkableUrl(data.url)) {
        showMessage(extT('msgUrlNotSavable', 'This URL cannot be saved. Use a normal http(s) page.'), 'error');
        return;
    }
    try {
        const response = await postInboxLink(data.serverUrl, data.url, {
            title: data.name,
            note: data.note,
            source: 'extension',
        });
        if (response.status === 409) {
            showMessage(extT('msgInboxDuplicate', 'This URL is already in Inbox.'), 'info');
            return;
        }
        if (!response.ok) throw new Error('inbox save failed');
        const base = normalizeServerUrl(data.serverUrl);
        const panel = document.getElementById('save-success-panel');
        const text = document.getElementById('save-success-text');
        const link = document.getElementById('open-nextdash-link');
        const form = document.getElementById('save-form');
        hideMessage();
        if (form) form.classList.add('hidden');
        if (text) {
            text.textContent = extT('saveInboxSuccess', 'Link saved to Inbox.');
        }
        if (panel) panel.classList.remove('hidden');
        if (link) {
            link.textContent = extT('openInboxInNextdash', 'Open Inbox in nextDash');
            link.href = `${base}/#inbox`;
        }
    } catch (error) {
        console.error('Error saving to inbox:', error);
        showMessage(extT('msgFailedInboxSave', 'Failed to save to Inbox. Check console for details.'), 'error');
    }
}

async function saveBookmarkAnyway() {
    const data = collectSaveFormData();
    if (!data.serverUrl) {
        showMessage(extT('msgSetServerUrl', 'Please set the nextDash URL in settings first.'), 'error');
        return;
    }
    if (!isBookmarkableUrl(data.url)) {
        showMessage(extT('msgUrlNotSavable', 'This URL cannot be saved. Use a normal http(s) page.'), 'error');
        return;
    }
    hideMessage();
    await performSave(
        data.serverUrl,
        data.pageId,
        data.name,
        data.url,
        data.category,
        data.note,
        data.tags,
        data.shortcut
    );
}

async function saveSettings(event) {
    event.preventDefault();

    const serverUrl = document.getElementById('server-url').value;
    const defaultPage = document.getElementById('default-page').value;
    const defaultCategory = document.getElementById('default-category').value;

    const allowDuplicateUrls = Boolean(
        document.getElementById('extension-allow-duplicate-urls')?.checked
    );
    extAllowDuplicateUrls = allowDuplicateUrls;
    const writeToken = String(document.getElementById('write-token')?.value || '').trim();

    await chrome.storage.sync.set({
        serverUrl: serverUrl,
        defaultPage: defaultPage,
        defaultCategory: defaultCategory,
        extensionAllowDuplicateUrls: allowDuplicateUrls,
        writeToken: writeToken,
    });

    try {
        const res = await fetch(new URL('/api/settings', serverUrl));
        if (res.ok) {
            const settings = await res.json();
            if (settings.language) {
                await chrome.storage.sync.set({ extensionLocale: settings.language });
                await initExtensionI18n();
            }
        }
    } catch (e) {
        // keep current locale
    }

    updateUrlDuplicateHint();
    showMessage(extT('msgSettingsSaved', 'Settings saved!'), 'success');
}

async function showSaveSuccess(serverUrl, pageId, bookmarkName) {
    const panel = document.getElementById('save-success-panel');
    const text = document.getElementById('save-success-text');
    const link = document.getElementById('open-nextdash-link');
    const form = document.getElementById('save-form');
    hideMessage();
    if (form) form.classList.add('hidden');
    if (text) {
        text.textContent = bookmarkName
            ? extT('saveSuccessNamed', '"{name}" saved to nextDash.', { name: bookmarkName })
            : extT('saveSuccess', 'Bookmark saved to nextDash.');
    }
    if (panel) panel.classList.remove('hidden');
    if (link) {
        link.textContent = extT('openInNextdash', 'Open in nextDash');
        buildDashboardDeepLink(serverUrl, pageId).then((href) => {
            link.href = href;
        });
    }
}

async function performSave(serverUrl, pageId, name, url, category, note, tags, shortcut = '') {
    try {
        const extras = {
            icon: extDraftState.icon || undefined,
            previewTitle: extDraftState.previewTitle || undefined,
            previewDesc: extDraftState.previewDesc || undefined,
            previewImage: extDraftState.previewImage || undefined,
            shortcut,
        };
        let response = await postAddBookmark(serverUrl, pageId, name, url, category, note, tags, extras);
        if (response.status === 409) {
            let body = {};
            try {
                body = await response.json();
            } catch (_error) {
                // ignore parse errors
            }
            if (body.error === 'duplicate_shortcut') {
                showMessage(
                    extT('msgShortcutConflict', 'Shortcut "{shortcut}" is already in use.', {
                        shortcut: String(body.shortcut || shortcut || ''),
                    }),
                    'error'
                );
                return;
            }
            if (body.error === 'duplicate_url') {
                const where = [body.conflict?.pageName, body.conflict?.categoryName]
                    .map((part) => String(part || '').trim())
                    .filter(Boolean)
                    .join(' · ');
                // The popup has no room for a dialog, so the question is asked
                // as a message and answered by pressing save a second time —
                // which is the confirmation the dashboard shows a modal for.
                if (!body.samePage && !extDuplicateAcknowledged) {
                    extDuplicateAcknowledged = true;
                    showMessage(
                        where
                            ? extT('msgDuplicateElsewhereWhere', 'Already saved on {where}. Save again to add a second copy.', { where })
                            : extT('msgDuplicateElsewhere', 'Already saved somewhere else. Save again to add a second copy.'),
                        'info'
                    );
                    return;
                }
                if (body.samePage) {
                    showMessage(
                        extT('msgDuplicateSamePage', 'This page already has this link.'),
                        'error'
                    );
                    return;
                }
                response = await postAddBookmark(serverUrl, pageId, name, url, category, note, tags,
                    { ...extras, allowDuplicate: true });
            }
        }
        if (!response.ok) throw new Error('Failed to save bookmark');
        extDuplicateAcknowledged = false;

        await persistLastSaveContext(serverUrl, pageId, category);
        const toastMessage = name
            ? extT('notifySavedNamed', '"{name}" saved to nextDash', { name: String(name).slice(0, 80) })
            : extT('notifySaved', 'Bookmark saved to nextDash');
        await notifyDashboardBookmarkSaved(serverUrl, pageId, name, toastMessage);
        showSaveSuccess(serverUrl, pageId, name);
    } catch (error) {
        console.error('Error saving bookmark:', error);
        showMessage(extT('msgFailedSave', 'Failed to save bookmark. Check console for details.'), 'error');
    }
}

async function resetSettings() {
    await chrome.storage.sync.clear();
    await chrome.storage.local.remove('lastSaveContext');
    
    // Reset form fields
    document.getElementById('server-url').value = '';
    const writeTokenInput = document.getElementById('write-token');
    if (writeTokenInput) writeTokenInput.value = '';
    document.getElementById('default-page').innerHTML = '';
    document.getElementById('default-category').innerHTML = '';
    
    // Clear pages in save tab as well
    document.getElementById('page-select').innerHTML = '';
    document.getElementById('category-select').innerHTML = '';

    extAllowDuplicateUrls = false;
    const allowCheckbox = document.getElementById('extension-allow-duplicate-urls');
    if (allowCheckbox) allowCheckbox.checked = false;
    updateUrlDuplicateHint();

    showMessage(extT('msgSettingsReset', 'Settings reset!'), 'info');
}