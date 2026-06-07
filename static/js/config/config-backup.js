/**
 * Backup Module
 * Handles data backup and export functionality
 */

class ConfigBackup {
    constructor(t) {
        this.t = t; // Translation function
        this.init();
    }

    /**
     * Normalize paths from ZIP tools (Windows slashes, ./ prefix, junk folders).
     */
    normalizeZipEntryName(name) {
        if (!name || typeof name !== 'string') {
            return '';
        }
        let n = name.replace(/\\/g, '/').replace(/^\.\/+/, '');
        const base = n.split('/').pop() || '';
        if (n.startsWith('__MACOSX/') || n.includes('/__MACOSX/')) {
            return '';
        }
        if (base.startsWith('._')) {
            return '';
        }
        return n;
    }

    setButtonLoading(btn, loading, loadingText) {
        if (!btn) return;
        if (loading) {
            btn._originalText = btn.textContent;
            btn.textContent = loadingText || btn.textContent;
            btn.classList.add('btn-loading');
            btn.disabled = true;
        } else {
            btn.textContent = btn._originalText || btn.textContent;
            btn.classList.remove('btn-loading');
            btn.disabled = false;
        }
    }

    /**
     * Initialize the backup functionality
     */
    init() {
        const backupBtn = document.getElementById('backup-btn');
        if (backupBtn) {
            backupBtn.addEventListener('click', () => this.createBackup());
        }

        // Backup info button
        const backupInfoBtn = document.getElementById('backup-info-btn');
        if (backupInfoBtn) {
            backupInfoBtn.addEventListener('click', () => {
                if (window.AppModal) {
                    window.AppModal.alert({
                        title: this.t('config.backupInfoTitle'),
                        message: this.t('config.backupInfo'),
                        confirmText: this.t('config.backupInfoConfirm')
                    });
                }
            });
        }

        // Import functionality
        const importBtn = document.getElementById('import-btn');
        const importFile = document.getElementById('import-file');
        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => {
                importFile.click();
            });

            importFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleImportFile(file);
                }
            });
        }

        // CSV export
        const csvExportBtn = document.getElementById('csv-export-btn');
        if (csvExportBtn) {
            csvExportBtn.addEventListener('click', () => this.exportBookmarksCSV());
        }

        // Browser bookmark import
        const browserImportBtn = document.getElementById('browser-import-btn');
        const browserImportFile = document.getElementById('browser-import-file');
        if (browserImportBtn && browserImportFile) {
            browserImportBtn.addEventListener('click', () => browserImportFile.click());
            browserImportFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.handleBrowserImportFile(file);
                e.target.value = '';
            });
        }

        // Import info button
        const importInfoBtn = document.getElementById('import-info-btn');
        if (importInfoBtn) {
            importInfoBtn.addEventListener('click', () => {
                if (window.AppModal) {
                    const importInfo = this.t('config.importInfo');
                    const parts = importInfo.split('\n\n');
                    const htmlMessage = parts[0] + '<br><br><span class="danger">' + parts[1] + '</span>';
                    window.AppModal.alert({
                        title: this.t('config.importInfoTitle'),
                        htmlMessage: htmlMessage,
                        confirmText: this.t('config.importInfoConfirm')
                    });
                }
            });
        }
    }

    /**
     * Create and download a backup of all data
     */
    async createBackup() {
        const backupBtn = document.getElementById('backup-btn');
        if (!backupBtn) return;

        this.setButtonLoading(backupBtn, true, this.t('config.backupInProgress') || 'Creating…');
        try {
            const response = await fetch('/api/backup', { method: 'GET' });

            if (!response.ok) {
                throw new Error(`Backup failed: ${response.statusText}`);
            }

            const now = new Date();
            const timestamp = now.toISOString().replace('T', '_').replace(/\..+/, '').replace(':', '-').replace(':', '-');
            const filename = `nextDash-backup-${timestamp}.zip`;
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            if (typeof configManager !== 'undefined' && configManager.ui) {
                configManager.ui.showNotification(this.t('config.backupCreated') || 'Backup created successfully!', 'success');
            }
        } catch (error) {
            console.error('Backup error:', error);
            if (typeof configManager !== 'undefined' && configManager.ui) {
                configManager.ui.showNotification(this.t('config.backupError') || 'Failed to create backup. Please try again.', 'error');
            }
        } finally {
            this.setButtonLoading(backupBtn, false);
        }
    }

    /**
     * Collect normalized entry names from a loaded ZIP (files only).
     */
    getZipFileNames(zip) {
        const names = [];
        for (const zipEntry of Object.values(zip.files)) {
            if (!zipEntry || zipEntry.dir) {
                continue;
            }
            const n = this.normalizeZipEntryName(zipEntry.name);
            if (n) {
                names.push(n);
            }
        }
        return names;
    }

    /**
     * Handle the selected import file
     * @param {File} file
     */
    async handleImportFile(file) {
        try {
            if (!file.name.endsWith('.zip')) {
                if (typeof configManager !== 'undefined' && configManager.ui) {
                    configManager.ui.showNotification(this.t('config.importInvalidFile'), 'error');
                }
                return;
            }

            const zip = await JSZip.loadAsync(file);
            const files = this.getZipFileNames(zip);

            // Check for required files
            const requiredFiles = ['settings.json', 'colors.json', 'pages.json'];
            const hasBookmarks = files.some((filename) => filename.startsWith('bookmarks-') && filename.endsWith('.json'));

            const hasRequiredFiles = requiredFiles.every((requiredFile) => files.includes(requiredFile));

            if (!hasRequiredFiles || !hasBookmarks) {
                if (typeof configManager !== 'undefined' && configManager.ui) {
                    configManager.ui.showNotification(this.t('config.importInvalidFile'), 'error');
                }
                return;
            }

            // Clear the file input immediately after validation
            const importFileEl = document.getElementById('import-file');
            if (importFileEl) {
                importFileEl.value = '';
            }

            // Count pages and bookmarks in the ZIP for the preview
            const bookmarkFiles = files.filter(f => f.startsWith('bookmarks-') && f.endsWith('.json'));
            let totalBookmarks = 0;
            for (const fileName of bookmarkFiles) {
                try {
                    const content = await zip.file(fileName).async('string');
                    const parsed = JSON.parse(content);
                    totalBookmarks += Array.isArray(parsed.bookmarks) ? parsed.bookmarks.length : 0;
                } catch { /* skip unreadable files */ }
            }
            const pageCount = bookmarkFiles.length;

            let confirmed = false;
            if (window.AppModal) {
                confirmed = await window.AppModal.confirm({
                    title: this.t('config.importConfirmTitle'),
                    htmlMessage: `
                        <p>${this.t('config.importConfirmMessage')}</p>
                        <p style="margin-top:0.75rem;opacity:0.8;font-size:0.9em;">
                            ${pageCount} page${pageCount !== 1 ? 's' : ''},
                            ${totalBookmarks} bookmark${totalBookmarks !== 1 ? 's' : ''}
                        </p>`,
                    confirmText: this.t('config.importConfirm'),
                    cancelText: this.t('config.cancelImport'),
                    confirmClass: 'danger'
                });
            } else {
                confirmed = window.confirm(this.t('config.importConfirmMessage'));
            }

            if (confirmed) {
                const importBtn = document.getElementById('import-btn');
                this.setButtonLoading(importBtn, true, this.t('config.importInProgress') || 'Importing…');
                try {
                    await this.performImport(zip);
                } finally {
                    this.setButtonLoading(importBtn, false);
                }
            }
        } catch (error) {
            console.error('Import validation error:', error);
            if (typeof configManager !== 'undefined' && configManager.ui) {
                configManager.ui.showNotification(this.t('config.importError'), 'error');
            }
        } finally {
            const importFileEl = document.getElementById('import-file');
            if (importFileEl) {
                importFileEl.value = '';
            }
        }
    }

    /**
     * Export all bookmarks as a CSV file
     */
    async exportBookmarksCSV() {
        const btn = document.getElementById('csv-export-btn');
        this.setButtonLoading(btn, true, this.t('config.csvExportInProgress') || 'Exporting…');
        try {
            const [bookmarksRes, pagesRes] = await Promise.all([
                fetch('/api/bookmarks?all=true'),
                fetch('/api/pages')
            ]);
            if (!bookmarksRes.ok || !pagesRes.ok) throw new Error('fetch failed');

            const bookmarks = await bookmarksRes.json();
            const pages = await pagesRes.json();
            const pageNames = Object.fromEntries(pages.map(p => [p.id, p.name]));

            const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const header = ['Name', 'URL', 'Category', 'Page', 'Shortcut'].map(escape).join(',');
            const rows = bookmarks.map(bm => [
                escape(bm.name),
                escape(bm.url),
                escape(bm.category),
                escape(pageNames[bm.pageId] ?? bm.pageId ?? ''),
                escape(bm.shortcut)
            ].join(','));

            const csv = '﻿' + [header, ...rows].join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().slice(0, 10);
            a.download = `nextdash-bookmarks-${date}.csv`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);

            if (configManager?.ui) configManager.ui.showNotification(this.t('config.csvExportSuccess'), 'success');
        } catch (e) {
            console.error('CSV export error:', e);
            if (configManager?.ui) configManager.ui.showNotification(this.t('config.csvExportError'), 'error');
        } finally {
            this.setButtonLoading(btn, false);
        }
    }

    canonicalUrlKey(url) {
        if (typeof BookmarkUrlUtils !== 'undefined') {
            return BookmarkUrlUtils.canonicalBookmarkURLKey(url);
        }
        return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
    }

    /**
     * Same dedup rules as POST /api/bookmarks/import-browser (page URLs + first wins in file).
     * @param {Array<{name, url, category}>} bookmarks
     * @param {Set<string>} existingUrlKeys
     * @returns {{ newCount: number, conflictCount: number, toImport: Array }}
     */
    planBrowserImport(bookmarks, existingUrlKeys) {
        const seen = new Set(existingUrlKeys);
        const toImport = [];
        let conflictCount = 0;
        for (const bm of bookmarks) {
            const key = this.canonicalUrlKey(bm.url);
            if (seen.has(key)) {
                conflictCount++;
                continue;
            }
            seen.add(key);
            toImport.push(bm);
        }
        return { newCount: toImport.length, conflictCount, toImport };
    }

    async fetchPageUrlKeys(pageId, cache) {
        if (cache.has(pageId)) {
            return cache.get(pageId);
        }
        let keys = new Set();
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (res.ok) {
                const list = await res.json();
                keys = new Set(list.map((b) => this.canonicalUrlKey(b.url)));
            }
        } catch (e) {
            console.warn('Could not load page bookmarks for import preview', e);
        }
        cache.set(pageId, keys);
        return keys;
    }

    formatBrowserImportSummary(plan) {
        return this.t('config.browserImportPreviewSummary')
            .replace('{{newCount}}', plan.newCount)
            .replace('{{conflictCount}}', plan.conflictCount);
    }

    buildBrowserImportModalHtml({ foundText, summaryText, pageOptions, previewItems, moreCount, noNew }) {
        const noNewHtml = noNew
            ? `<p class="browser-import-no-new" id="browser-import-no-new">${this.t('config.browserImportNoNew')}</p>`
            : '<p class="browser-import-no-new" id="browser-import-no-new" hidden></p>';
        return `
            <div class="browser-import-modal">
                <p class="browser-import-found">${foundText}</p>
                <p class="browser-import-summary" id="browser-import-summary" aria-live="polite">${summaryText}</p>
                ${noNewHtml}
                <div class="browser-import-page-row">
                    <label for="browser-import-page-select">${this.t('config.browserImportPageLabel')}</label>
                    <select id="browser-import-page-select">${pageOptions}</select>
                </div>
                <ul class="browser-import-preview-list" id="browser-import-preview-list">
                    ${previewItems}
                    ${moreCount > 0 ? `<li class="browser-import-preview-more">… ${moreCount} more</li>` : ''}
                </ul>
            </div>`;
    }

    renderBrowserImportPreviewItems(bookmarks, limit = 5) {
        return bookmarks
            .slice(0, limit)
            .map(
                (b) =>
                    `<li title="${(b.url || '').replace(/"/g, '&quot;')}">${(b.name || b.url || '').replace(/</g, '&lt;')}</li>`
            )
            .join('');
    }

    /**
     * Parse Netscape HTML bookmark format exported from browsers
     * @param {string} html
     * @returns {Array<{name, url, category}>}
     */
    parseBrowserBookmarks(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const bookmarks = [];

        function walkDl(container, folderName) {
            const elements = Array.from(container.children);
            let i = 0;
            while (i < elements.length) {
                const el = elements[i];
                if (el.tagName === 'DT') {
                    const h3 = el.querySelector('h3');
                    const a = el.querySelector('a[href]');
                    if (h3 && !a) {
                        const name = h3.textContent.trim();
                        if (i + 1 < elements.length && elements[i + 1].tagName === 'DL') {
                            walkDl(elements[i + 1], name);
                            i++;
                        }
                    } else if (a) {
                        const href = a.getAttribute('href');
                        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                            bookmarks.push({ name: a.textContent.trim() || href, url: href, category: folderName });
                        }
                    }
                } else if (el.tagName === 'DL' || el.tagName === 'P') {
                    walkDl(el, folderName);
                }
                i++;
            }
        }

        const topDl = doc.querySelector('dl');
        if (topDl) walkDl(topDl, '');
        return bookmarks;
    }

    /**
     * Handle a browser bookmark HTML file selected by the user
     * @param {File} file
     */
    async handleBrowserImportFile(file) {
        if (!file.name.match(/\.(html?|htm)$/i)) {
            if (configManager?.ui) configManager.ui.showNotification(this.t('config.browserImportInvalidFile'), 'error');
            return;
        }

        let bookmarks;
        try {
            const html = await file.text();
            bookmarks = this.parseBrowserBookmarks(html);
        } catch (e) {
            if (configManager?.ui) configManager.ui.showNotification(this.t('config.browserImportError'), 'error');
            return;
        }

        if (bookmarks.length === 0) {
            if (configManager?.ui) configManager.ui.showNotification(this.t('config.browserImportEmpty'), 'error');
            return;
        }

        let pages = [];
        try {
            const res = await fetch('/api/pages');
            pages = await res.json();
        } catch (e) {
            pages = [{ id: 1, name: 'main' }];
        }

        const folders = [...new Set(bookmarks.map((b) => b.category).filter((c) => c))];
        const pageOptions = pages
            .map((p) => `<option value="${p.id}">${p.name}</option>`)
            .join('');
        const defaultPageId = pages[0]?.id || 1;
        const pageUrlKeysCache = new Map();
        await Promise.all(pages.map((p) => this.fetchPageUrlKeys(p.id, pageUrlKeysCache)));

        let currentPlan = this.planBrowserImport(
            bookmarks,
            pageUrlKeysCache.get(defaultPageId) || new Set()
        );

        const foundText = this.t('config.browserImportFound')
            .replace('{{count}}', bookmarks.length)
            .replace('{{folders}}', folders.length);

        let previewList = currentPlan.toImport;
        let moreCount = Math.max(0, previewList.length - 5);
        const htmlMessage = this.buildBrowserImportModalHtml({
            foundText,
            summaryText: this.formatBrowserImportSummary(currentPlan),
            pageOptions,
            previewItems: this.renderBrowserImportPreviewItems(previewList),
            moreCount,
            noNew: currentPlan.newCount === 0,
        });

        if (!window.AppModal) return;

        let importPlan = currentPlan;
        const confirmed = await new Promise((resolve) => {
            window.AppModal.show({
                title: this.t('config.browserImportConfirmTitle'),
                htmlMessage,
                confirmText: this.t('config.browserImportConfirm'),
                cancelText: this.t('config.cancelImport'),
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false),
            });

            const summaryEl = document.getElementById('browser-import-summary');
            const noNewEl = document.getElementById('browser-import-no-new');
            const previewEl = document.getElementById('browser-import-preview-list');
            const selectEl = document.getElementById('browser-import-page-select');
            const confirmBtn = document.querySelector('#app-modal .modal-button:first-child');

            const applyPlan = (plan) => {
                importPlan = plan;
                if (summaryEl) summaryEl.textContent = this.formatBrowserImportSummary(plan);
                if (noNewEl) {
                    if (plan.newCount === 0) {
                        noNewEl.hidden = false;
                    } else {
                        noNewEl.hidden = true;
                    }
                }
                if (previewEl) {
                    const list = plan.toImport;
                    const more = Math.max(0, list.length - 5);
                    previewEl.innerHTML =
                        this.renderBrowserImportPreviewItems(list) +
                        (more > 0
                            ? `<li class="browser-import-preview-more">… ${more} more</li>`
                            : '');
                }
                if (confirmBtn) {
                    confirmBtn.disabled = plan.newCount === 0;
                    confirmBtn.setAttribute('aria-disabled', plan.newCount === 0 ? 'true' : 'false');
                }
            };

            if (confirmBtn && currentPlan.newCount === 0) {
                confirmBtn.disabled = true;
                confirmBtn.setAttribute('aria-disabled', 'true');
            }

            selectEl?.addEventListener('change', async () => {
                const pageId = parseInt(selectEl.value, 10) || defaultPageId;
                const keys = await this.fetchPageUrlKeys(pageId, pageUrlKeysCache);
                applyPlan(this.planBrowserImport(bookmarks, keys));
            });
        });

        if (confirmed) {
            const pageId = (() => {
                const el = document.getElementById('browser-import-page-select');
                return el ? parseInt(el.value, 10) || defaultPageId : defaultPageId;
            })();
            const keys = pageUrlKeysCache.get(pageId) || new Set();
            const finalPlan = this.planBrowserImport(bookmarks, keys);
            if (finalPlan.newCount > 0) {
                const browserBtn = document.getElementById('browser-import-btn');
                this.setButtonLoading(browserBtn, true, this.t('config.importInProgress') || 'Importing…');
                try {
                    await this.performBrowserImport(finalPlan.toImport, pageId);
                } finally {
                    this.setButtonLoading(browserBtn, false);
                }
            }
        }
    }

    /**
     * POST parsed bookmarks to the server
     * @param {Array} bookmarks
     * @param {number} pageId
     */
    async performBrowserImport(bookmarks, pageId) {
        try {
            const res = await fetch('/api/bookmarks/import-browser', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, bookmarks })
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(errText || `HTTP ${res.status}`);
            }
            const result = await res.json();
            const msg = this.t('config.browserImportSuccess')
                .replace('{{imported}}', result.imported)
                .replace('{{skipped}}', result.skipped);
            if (configManager?.ui) configManager.ui.showNotification(msg, 'success');
            if (typeof configManager !== 'undefined') {
                await configManager.loadPageBookmarks(pageId);
            }
        } catch (e) {
            console.error('Browser import error:', e);
            if (configManager?.ui) configManager.ui.showNotification(this.t('config.browserImportError'), 'error');
        }
    }

    /**
     * Perform the import operation
     * @param {JSZip} zip
     */
    async performImport(zip) {
        try {
            const formData = new FormData();

            for (const zipEntry of Object.values(zip.files)) {
                if (!zipEntry || zipEntry.dir) {
                    continue;
                }
                const normalizedName = this.normalizeZipEntryName(zipEntry.name);
                if (!normalizedName) {
                    continue;
                }
                const content = await zipEntry.async('blob');
                formData.append('files', content, normalizedName);
            }

            const importHeaders = typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {};
            const response = await fetch('/api/import', {
                method: 'POST',
                headers: importHeaders,
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(errText || `Import failed: ${response.status} ${response.statusText}`);
            }

            const result = await response.json().catch(() => ({}));
            const skipped = Number(result.skippedBookmarks) || 0;

            if (typeof configManager !== 'undefined' && configManager.ui) {
                if (skipped > 0) {
                    const msg = (this.t('config.importSuccessSkipped')
                        || 'Import completed. {count} bookmark(s) with disallowed URLs were skipped.')
                        .replace('{count}', String(skipped));
                    configManager.ui.showNotification(msg, 'warning');
                } else {
                    configManager.ui.showNotification(this.t('config.importSuccess'), 'success');
                }
            }

            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } catch (error) {
            console.error('Import error:', error);
            if (typeof configManager !== 'undefined' && configManager.ui) {
                const rawMessage = String(error?.message || '').trim();
                const displayMessage = rawMessage && !rawMessage.startsWith('Import failed:')
                    ? `${this.t('config.importError')} (${rawMessage})`
                    : (rawMessage || this.t('config.importError'));
                configManager.ui.showNotification(displayMessage, 'error');
            }
        }
    }
}
