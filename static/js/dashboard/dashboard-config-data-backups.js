/**
 * Config → Data & backups: backups, restore, import and export, the trash, sources and webhooks.
 *
 * Moved out of dashboard-config.js verbatim: same methods, same prototype, same
 * order. Only the moment the file arrives has changed — it is fetched when this
 * section is opened rather than on every visit to any other one.
 *
 * The bodies are not re-indented. Several of them build markup from multi-line
 * template literals, and shifting every line four spaces to the right would
 * change the strings they produce.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /*
     * The services nextDash can pull bookmarks from.
     *
     * One descriptor per source rather than a hand-written panel each: cluster A
     * is a dozen of these, and every one of them asks the same four questions --
     * what is your token, where should they land, import now, forget it. Written
     * out twelve times that is twelve places to fix the next bug in; written
     * once it is a row in this list.
     *
     * `id` is the key in sources.json, `kind` selects the importer server-side.
     * `tokenHelp` is where the reader gets the token, because "personal access
     * token" is not an instruction if you have never made one.
     */
    global.DashboardConfig.SOURCE_DEFS = [
        {
            id: 'github:stars',
            kind: 'github-stars',
            slug: 'stars',
            titleKey: 'starsSectionTitle',
            titleFallback: 'GitHub stars',
            descKey: 'starsDescription',
            descFallback: 'Import the repositories you starred, with their description and language. Needs a personal access token; nextDash only ever reads.',
            tokenHelpKey: 'starsTokenHelp',
            tokenHelpFallback: 'Create one at github.com/settings/tokens — no scopes needed for public stars.',
            tokenPlaceholder: 'ghp_…',
            categoryFallback: 'GitHub',
        },
        {
            id: 'raindrop:all',
            kind: 'raindrop',
            slug: 'raindrop',
            titleKey: 'raindropSectionTitle',
            titleFallback: 'Raindrop.io',
            descKey: 'raindropDescription',
            descFallback: 'Import your Raindrop collections, with their tags, notes and the date you saved each one. Needs a test token; nextDash only ever reads.',
            tokenHelpKey: 'raindropTokenHelp',
            tokenHelpFallback: 'app.raindrop.io/settings/integrations — create an app, then copy its test token.',
            tokenPlaceholder: '…',
            categoryFallback: 'Raindrop',
        },
        /*
         * The three that identify an account rather than authenticate one.
         *
         * needsHandle puts a second field on the panel; needsToken false hides
         * the token pair entirely, because a panel asking for a token that is
         * never sent is a panel that looks broken.
         */
        {
            id: 'hn:favorites',
            kind: 'hackernews',
            slug: 'hn',
            needsHandle: true,
            needsToken: false,
            offersRows: true,
            titleKey: 'hnSectionTitle',
            titleFallback: 'Hacker News favorites',
            descKey: 'hnDescription',
            descFallback: 'Import what you starred on Hacker News. No token and no account needed — just your username.',
            handleLabelKey: 'hnHandleLabel',
            handleLabelFallback: 'Hacker News username',
            handlePlaceholder: 'pg',
            categoryFallback: 'Hacker News',
        },
        {
            id: 'youtube:channel',
            kind: 'youtube',
            slug: 'youtube',
            needsHandle: true,
            needsToken: false,
            offersRows: true,
            titleKey: 'youtubeSectionTitle',
            titleFallback: 'YouTube channel',
            descKey: 'youtubeDescription',
            descFallback: 'Follow a channel through its public feed. No API key and no quota; a handle is resolved to a channel id for you.',
            handleLabelKey: 'youtubeHandleLabel',
            handleLabelFallback: 'Channel',
            handlePlaceholder: '@handle, UC… id, or a channel URL',
            categoryFallback: 'YouTube',
        },
        {
            id: 'mastodon:bookmarks',
            kind: 'mastodon',
            slug: 'mastodon',
            needsHandle: true,
            titleKey: 'mastodonSectionTitle',
            titleFallback: 'Mastodon bookmarks',
            descKey: 'mastodonDescription',
            descFallback: 'Import the posts you bookmarked. Needs an access token from your own instance; nextDash only ever reads.',
            handleLabelKey: 'mastodonHandleLabel',
            handleLabelFallback: 'Instance',
            handlePlaceholder: 'mastodon.social',
            tokenHelpKey: 'mastodonTokenHelp',
            tokenHelpFallback: 'Your instance → Preferences → Development → New application, with the read:bookmarks scope.',
            tokenPlaceholder: '…',
            categoryFallback: 'Mastodon',
        },
    ];

    /** Everything except the destructive actions, which live on their own tab. */
    /**
     * The ℹ beside a backup control: the explanation lives in a dialog and not
     * under every row, so the page reads as a list of things to do.
     */
    global.DashboardConfig.DB_INFO = {
        status: ['dbInfoStatusTitle', 'dbInfoStatusMessage', 'Backups',
            'A backup is one zip with your bookmarks, pages, widgets and settings. Back up now saves it on this machine; Download gives you the file as well. Keep a copy somewhere other than this machine: a backup next to the data it protects does not survive losing the disk.'],
        auto: ['dbInfoAutoTitle', 'dbInfoAutoMessage', 'Automatic backups',
            'nextDash writes a backup on this machine at the interval you choose and keeps the newest ones. Making another one, or restoring, removes the oldest.'],
        archives: ['dbInfoArchivesTitle', 'dbInfoArchivesMessage', 'Local copies of pages',
            'A saved page may be the only copy left, and these are by far the largest thing in a backup.'],
        secrets: ['dbInfoSecretsTitle', 'dbInfoSecretsMessage', 'Tokens and passwords',
            'Import tokens and the keys a health check signs in with. Including them means a restore needs nothing typed in again, and that the backup file itself is a secret.'],
        restoreFile: ['dbInfoRestoreFileTitle', 'dbInfoRestoreFileMessage', 'Restore from a file',
            'Puts an earlier backup back. What it contains replaces what is here. The current data is copied first, so you can go back.'],
        restoreStored: ['dbInfoRestoreStoredTitle', 'dbInfoRestoreStoredMessage', 'Stored backups',
            'The copies already on this machine, newest first. Restore puts one back, Download gives you the file, Delete removes it.'],
        bookmarks: ['dbInfoBookmarksTitle', 'dbInfoBookmarksMessage', 'Bookmarks',
            'HTML is the format browsers import and export. CSV opens in a spreadsheet and moves bookmarks between nextDash installs.'],
        settings: ['dbInfoSettingsTitle', 'dbInfoSettingsMessage', 'Settings',
            'Your settings (looks, layout and options) as a JSON file, without bookmarks. Import it on another nextDash to get the same setup.'],
    };

    /*
     * The page a source writes to, chosen rather than inherited.
     *
     * It used to be whichever page happened to be open when the token was
     * saved, which is not a choice anyone made: import a month later from a
     * different page and the bookmarks land somewhere else entirely, and it
     * reads as nothing having happened.
     *
     * The same shape as the bookmark form's page field, down to the "+ New
     * page" entry and the shared InlineCreateRow it opens, because it is the
     * same decision and should not need learning twice.
     */
    global.DashboardConfig.SOURCE_NEW_PAGE = '__new__';

    Object.assign(global.DashboardConfig.prototype, {

    /** "· 412 bookmarks on 5 pages", or nothing where the archive was unreadable. */
    backupContentsLabel(backup) {
        const bookmarks = Number(backup?.bookmarks) || 0;
        const pages = Number(backup?.pages) || 0;
        if (!bookmarks && !pages) return '';
        return ` · ${this.t('config.backupContents', '{bookmarks} bookmarks on {pages} pages')
            .replace('{bookmarks}', this.statsNumber(bookmarks))
            .replace('{pages}', this.statsNumber(pages))}`;
    },

    bindDataBackupsActions(container) {
        // The folds on this section remember whether they were open, so a
        // repaint after a backup or an import does not shut the panel someone
        // is working in.
        this.bindFolds(container);
        // A deep link straight to the trash tab renders before anything has been
        // fetched, so the first paint would stay on "Loading…" forever without
        // this.
        if (this.dbTab === 'trash' && this._trashData == null) {
            void this.loadTrash();
        }
        if (this.dbTab === 'webhooks') {
            this.bindWebhookControls(container);
            // Fetched on open rather than with the section: the other tabs
            // should not pay for a list they never show.
            if (this._webhookEndpoints == null) void this.loadWebhooks();
        }
        this.bindSubTabStrip(container, 'data-db-tab', (tab) => {
            if (tab === this.dbTab) return;
            this.dbTab = tab;
            this.restoreConfigHash();
            // Only the body is repainted; rebuilding the strip would replace
            // the button that was just clicked.
            const body = document.getElementById('config-db-body');
            if (body) {
                // Bind the new body only: re-binding the whole container would
                // stack a second listener on every tab button.
                body.innerHTML = this.renderDbTab();
                this.bindDataBackupsActions(body);
                this.syncSectionTabNote('data-backups', this.dbTab, body.parentElement);
            }
            this.syncSubTabStrip('data-db-tab', this.dbTab);
            // Fetched on open rather than with the section, so the other two
            // tabs do not pay for a list they never show.
            if (tab === 'trash') {
                void this.loadTrash();
            }
        });
        container.querySelectorAll('[data-trash-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void this.handleTrashAction(
                    btn.getAttribute('data-trash-action'),
                    btn.getAttribute('data-trash-id')
                );
            });
        });
        const search = container.querySelector('[data-trash-search]');
        if (search) {
            search.addEventListener('input', () => {
                this._trashQuery = search.value;
                this.repaintTrashBody({ keepFocus: true });
            });
        }
        container.querySelectorAll('[data-trash-select]').forEach((box) => {
            box.addEventListener('change', () => {
                if (!(this._trashSelected instanceof Set)) this._trashSelected = new Set();
                const id = String(box.getAttribute('data-trash-select'));
                if (box.checked) this._trashSelected.add(id);
                else this._trashSelected.delete(id);
                this.repaintTrashBody();
            });
        });
        container.querySelectorAll('[data-backup-action]').forEach((btn) => {
            btn.addEventListener('click', () => this.handleBackupAction(btn.getAttribute('data-backup-action')));
        });
        container.querySelectorAll('[data-db-info]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openDbInfo(btn.getAttribute('data-db-info'));
            });
        });
        container.querySelectorAll('[data-backup-item]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.handleBackupItem(btn.getAttribute('data-backup-item'), btn.getAttribute('data-backup-name'));
            });
        });
        const bindFileInput = (id, handler) => {
            const input = container.querySelector(id);
            if (!input) return;
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (file) void handler.call(this, file);
                input.value = '';
            });
        };
        bindFileInput('#config-import-input', this.importBackup);
        bindFileInput('#config-browser-import-input', this.importBrowserBookmarks);
        bindFileInput('#config-csv-import-input', this.importBookmarksCSV);
        bindFileInput('#config-settings-import-input', this.importSettings);

        // Whether a token is saved, and what the last round did. Read here
        // rather than rendered into the panels, because they are built from
        // settings the browser already has and this is the one thing on them
        // that only the server knows.
        if (container.querySelector('[data-local-archive-panel]')) {
            void this.loadLocalArchives();
            container.querySelectorAll('[data-local-archive-action]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    switch (btn.getAttribute('data-local-archive-action')) {
                        case 'capture': void this.captureLocalArchive(); break;
                        case 'refresh': void this.loadLocalArchives(); break;
                        default: break;
                    }
                });
            });
        }

        if (container.querySelector('[data-archive-panel]')) {
            void this.loadArchiveSettings();
            container.querySelector('[data-archive-toggle="archiveSaveEnabled"]')
                ?.addEventListener('change', (event) => {
                    void this.saveArchiveSettings({ enabled: event.target.checked });
                });
            container.querySelectorAll('[data-archive-action]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    switch (btn.getAttribute('data-archive-action')) {
                        case 'save': void this.saveArchiveSettings(); break;
                        case 'test': void this.testArchiveCapture(); break;
                        case 'forget': void this.forgetArchiveKeys(); break;
                        default: break;
                    }
                });
            });
        }

        if (container.querySelector('[data-source-panel]')) {
            this.bindSourceTokenDrafts(container);
            this.bindSourcePageSelects(container);
            void this.loadSourceStates();
        }

        // Every source panel is built from the same descriptor, so its buttons
        // carry which source they belong to rather than having an action name
        // each -- one more service is a row in SOURCE_DEFS, not three cases.
        container.querySelectorAll('[data-source-action]').forEach((btn) => {
            const id = btn.getAttribute('data-source-id');
            btn.addEventListener('click', () => {
                switch (btn.getAttribute('data-source-action')) {
                    case 'save': void this.saveSource(id); break;
                    case 'run': void this.runSource(id); break;
                    case 'forget': void this.forgetSource(id); break;
                    default: break;
                }
            });
        });

        container.querySelectorAll('[data-backup-toggle]').forEach((input) => {
            input.addEventListener('change', () => this.setBackupToggle(input.getAttribute('data-backup-toggle'), input.checked));
        });
        container.querySelectorAll('[data-backup-select]').forEach((select) => {
            select.addEventListener('change', () => this.setBackupSelect(select.getAttribute('data-backup-select'), select.value));
        });
    },

    /** Wire every fold on a container so it remembers itself. */
    bindFolds(container) {
        (container || document).querySelectorAll('[data-fold]').forEach((panel) => {
            if (panel.dataset.foldBound === 'true') return;
            panel.dataset.foldBound = 'true';
            panel.addEventListener('toggle', () => {
                this.rememberFold(panel.getAttribute('data-fold'), panel.open);
            });
        });
    },

    /** Wire each panel's page select, including its inline create row. */
    bindSourcePageSelects(container) {
        DashboardConfig.SOURCE_DEFS.forEach((def) => {
            const select = container.querySelector(`[data-source-page="${CSS.escape(def.id)}"]`);
            if (!select || select.dataset.bound === '1') return;
            select.dataset.bound = '1';
            this.fillSourcePageSelect(select, this.dash.currentPageId);

            const field = select.closest('[data-source-page-field]');
            if (!field || typeof window.InlineCreateRow !== 'function' && !window.InlineCreateRow?.create) {
                return;
            }
            const row = window.InlineCreateRow.create({
                kind: 'page',
                placeholder: this.t('config.newPageNamePlaceholder', 'Page name'),
                labels: {
                    create: this.t('config.create', 'Create'),
                    cancel: this.t('config.cancel', 'Cancel'),
                },
            });
            field.appendChild(row.box);

            // What the select showed before "+ New page…" was picked, so
            // cancelling puts it back rather than leaving the sentinel selected.
            let lastValue = select.value;

            const close = () => {
                row.box.hidden = true;
                row.error.hidden = true;
                row.input.value = '';
                select.hidden = false;
                select.value = lastValue;
                select.focus({ preventScroll: true });
            };

            window.InlineCreateRow.wire(row, {
                submit: async (name) => {
                    const created = await this.dash.structureCreate?.createPageFromForm?.(name);
                    if (!created || created.error) {
                        return created?.error || this.t('config.sourcePageCreateError', 'Could not create that page.');
                    }
                    this.fillSourcePageSelect(select, created.id);
                    select.value = String(created.id);
                    lastValue = select.value;
                    row.box.hidden = true;
                    row.error.hidden = true;
                    row.input.value = '';
                    select.hidden = false;
                    select.focus({ preventScroll: true });
                    return null;
                },
                onCancel: close,
            });
            row.box.__closeInlineCreate = close;

            select.addEventListener('change', () => {
                if (select.value !== DashboardConfig.SOURCE_NEW_PAGE) {
                    lastValue = select.value;
                    return;
                }
                // Put the real value back at once: a save while this row is open
                // must not read the sentinel as the target page.
                select.value = lastValue;
                select.hidden = true;
                row.box.hidden = false;
                row.error.hidden = true;
                row.input.value = '';
                row.input.focus({ preventScroll: true });
            });
        });
    },

    /** Put the drafts back after a render, and keep recording new ones. */
    bindSourceTokenDrafts(container) {
        DashboardConfig.SOURCE_DEFS.forEach((def) => {
            const field = container.querySelector(`#config-${def.slug}-token`);
            if (!field) return;
            const draft = this.sourceTokenDrafts.get(def.id);
            if (draft) field.value = draft;
            field.addEventListener('input', () => {
                if (field.value) this.sourceTokenDrafts.set(def.id, field.value);
                else this.sourceTokenDrafts.delete(def.id);
            });
        });
    },

    bindWebhookControls(container) {
        container.querySelectorAll('[data-webhook-action]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const form = btn.closest('[data-webhook-form]');
                void this.handleWebhookAction(btn.getAttribute('data-webhook-action'), form);
            });
        });
    },

    async captureLocalArchive(url) {
        const field = document.getElementById('config-local-archive-url');
        const target = String(url || field?.value || '').trim();
        if (!target) {
            this.notify(this.t('config.localArchiveNeedsUrl', 'Paste the address of the page to save.'), 'error');
            field?.focus();
            return;
        }

        // A capture fetches every asset on the page, which is genuinely slow --
        // go.dev took eleven seconds. The overlay says so rather than leaving
        // the button looking stuck.
        this.showProgressOverlay(
            this.t('config.localArchiveCapturingTitle', 'Saving a copy…'),
            this.t('config.localArchiveCapturingStatus', 'Fetching the page and everything on it'));
        try {
            const res = await this.writeFetch(`/api/archives/capture?url=${encodeURIComponent(target)}`, { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            this.hideProgressOverlay();
            if (!res.ok) {
                // monolith's own sentence: it says which asset or which flag
                // went wrong, which is more use than "capture failed".
                this.notify(body.error || this.t('config.localArchiveError', 'Could not save that page.'), 'error');
                return;
            }
            this.notify(this.t('config.localArchiveSaved', 'Saved {size}.')
                .replace('{size}', this.formatBytes(body.bytes || 0)), 'success');
            if (field) field.value = '';
            void this.loadLocalArchives();
        } catch {
            this.hideProgressOverlay();
            this.notify(this.t('config.localArchiveError', 'Could not save that page.'), 'error');
        }
    },

    categoryNameFor(names, bm) {
        const id = String(bm?.category || '');
        if (!id) return '';
        return names.get(`${bm.pageId}::${id}`) || id;
    },

    /*
     * The category names of these pages, keyed pageId::id.
     *
     * A bookmark stores its category as an id, and the CSV import reads that
     * column as a name: exported as the id, a round trip made categories called
     * "cat-lz3k-ab12" on every page.
     */
    async categoryNamesByPage(pageIds) {
        const names = new Map();
        await Promise.all([...new Set((pageIds || []).map(String))].map(async (pid) => {
            try {
                const res = await fetch(`/api/categories?page=${encodeURIComponent(pid)}`);
                const list = res.ok ? await res.json() : [];
                (Array.isArray(list) ? list : []).forEach((c) => {
                    if (c?.id) names.set(`${pid}::${c.id}`, String(c.name || c.id));
                });
            } catch { /* that page's column falls back to the id */ }
        }));
        return names;
    },

    /**
     * A page for an import to land on: "Imported", or "Imported 2" when the
     * name is taken. Resolves to the page's id, or 0 after saying why not.
     */
    async createImportPage() {
        const base = this.t('config.importNewPageName', 'Imported');
        for (let n = 1; n <= 20; n += 1) {
            const created = await this.dash.structureCreate?.createPageFromForm?.(n === 1 ? base : `${base} ${n}`);
            if (created && !created.error && created.id) return Number(created.id);
            if (!created?.error || !/exist/i.test(String(created.error))) break;
        }
        this.notify(this.t('config.sourcePageCreateError', 'Could not create that page.'), 'error');
        return 0;
    },

    /** The hash that shows a page, so a reload after an import lands on it. */
    pageHash(pageId) {
        const at = (this.dash.pages || []).findIndex((p) => Number(p.id) === Number(pageId));
        return at >= 0 ? `#${at + 1}` : '';
    },

    /**
     * The question every bookmark import asks before it writes: onto the
     * dashboard, or into the inbox to sort them there first.
     *
     * A backup restore never asks it -- that puts back a whole install, not a
     * pile of links. Built on confirmAction's overlay and keyboard contract,
     * with the config view's choice cards as the two answers.
     *
     * `onPage` and `toInbox` are the dry run's counts for each answer
     * ({ new, duplicates }); either may be missing when nothing was counted
     * up front (the CSV import), and the card then leaves the numbers out.
     * Resolves 'page', 'newpage' (where `newPage` offers it), 'inbox', or null for cancel.
     */
    async chooseImportDestination({ total, pageName, onPage, toInbox, newPage = false } = {}) {
        // Asked from the quick start too, where the views' stylesheet has not
        // been needed yet: without it the choices are bare browser buttons.
        await window.ViewStyles?.ensureViewStyles?.();
        const esc = (v) => this.dash.escapeHtml(v);
        document.getElementById('config-confirm-modal')?.remove();
        const counts = (c) => {
            if (!c) return '';
            const parts = [this.t('config.importDestNew', '{n} new').replace('{n}', String(Number(c.new) || 0))];
            if (Number(c.duplicates) > 0) {
                parts.push(this.t('config.importDestDuplicates', '{d} already here, skipped')
                    .replace('{d}', String(c.duplicates)));
            }
            return parts.join(' · ');
        };
        const cards = [
            {
                value: 'page',
                title: this.t('config.importDestPage', 'Onto the dashboard'),
                body: this.t('config.importDestPageBody', 'On “{p}”. Folders become categories.').replace('{p}', pageName || ''),
                counts: counts(onPage),
            },
            {
                value: 'inbox',
                title: this.t('config.importDestInbox', 'Into the inbox first'),
                body: this.t('config.importDestInboxBody', 'Sort them out one by one later. Folders become tags.'),
                counts: counts(toInbox),
            },
            // A page of its own, for someone who wants to keep what is already
            // on the page they are looking at. Only where the importer writes
            // to the current page: a source keeps the page it was set up with.
            ...(newPage ? [{
                value: 'newpage',
                title: this.t('config.importDestNewPage', 'On a new page'),
                body: this.t('config.importDestNewPageBody', 'A page of its own, so what is on “{p}” stays as it is. Folders become categories.').replace('{p}', pageName || ''),
                counts: counts(onPage),
            }] : []),
        ].map((c, i) => `
            <button type="button" class="config-choice-card${i === 0 ? ' is-active' : ''}" data-import-dest="${c.value}"
                    role="radio" aria-checked="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">
                <span class="config-choice-card-title">${esc(c.title)}</span>
                <span class="config-choice-card-body">${esc(c.body)}</span>
                ${c.counts ? `<span class="config-choice-card-body">${esc(c.counts)}</span>` : ''}
            </button>`).join('');
        const heading = this.t('config.importDestTitle', 'Import {n} bookmarks').replace('{n}', String(Number(total) || 0));
        const question = this.t('config.importDestQuestion', 'Where should they go?');
        document.body.insertAdjacentHTML('beforeend', `
            <div id="config-confirm-modal" class="modal-overlay" aria-hidden="false">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="config-confirm-title">
                    <div class="modal-header">
                        <span class="modal-title" id="config-confirm-title">${esc(heading)}</span>
                    </div>
                    <div class="modal-body">
                        <p class="config-confirm-message">${esc(question)}</p>
                        <div class="config-choice-cards config-import-dest" role="radiogroup" aria-label="${esc(question)}">${cards}</div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="modal-button" data-confirm="cancel">
                            <span class="modal-button-name">${esc(this.t('config.confirmCancel', 'Cancel'))}</span>
                        </button>
                        <button type="button" class="modal-button" data-confirm="ok">
                            <span class="modal-button-name">${esc(this.t('config.confirmImport', 'Import'))}</span>
                        </button>
                    </div>
                </div>
            </div>`);
        const overlay = document.getElementById('config-confirm-modal');
        const options = [...overlay.querySelectorAll('[data-import-dest]')];
        // The overlay is visibility:hidden until .show, and the scrim
        // transitions visibility too, so it is still hidden in the frame .show
        // goes on. A hidden button refuses focus and the arrows went to the
        // config view behind the dialog; tried again once the scrim is in.
        const focusFirst = () => {
            if (overlay.isConnected && !overlay.contains(document.activeElement)) options[0].focus();
        };
        requestAnimationFrame(() => {
            overlay.classList.add('show');
            focusFirst();
        });
        overlay.addEventListener('transitionend', focusFirst);
        const previouslyFocused = document.activeElement;
        let chosen = 'page';
        const select = (card, focus) => {
            chosen = card.dataset.importDest;
            for (const o of options) {
                const on = o === card;
                o.classList.toggle('is-active', on);
                o.setAttribute('aria-checked', on ? 'true' : 'false');
                o.tabIndex = on ? 0 : -1;
            }
            if (focus) card.focus();
        };

        return new Promise((resolve) => {
            let done = false;
            const finish = (result) => {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
                if (e.key === 'Tab') {
                    window.FocusTrapUtils?.trapTabKey?.(e, overlay.querySelector('.modal') || overlay);
                    return;
                }
                // A radio group moves with the arrows, as every other one does.
                const at = options.indexOf(document.activeElement);
                if (at >= 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
                    select(options[(at + step + options.length) % options.length], true);
                } else if (at >= 0 && e.key === 'Enter') {
                    // Enter on a card is the answer, not a second click on it.
                    e.preventDefault();
                    e.stopPropagation();
                    finish(chosen);
                }
            };
            document.addEventListener('keydown', onKey, true);
            for (const o of options) {
                o.addEventListener('click', () => select(o, false));
                o.addEventListener('dblclick', () => { select(o, false); finish(chosen); });
            }
            overlay.querySelector('[data-confirm="ok"]').addEventListener('click', () => finish(chosen));
            overlay.querySelector('[data-confirm="cancel"]').addEventListener('click', () => finish(null));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
        });
    },

    async clearAllPreviews() {
        if (!await this.confirmAction(this.t('config.clearAllPreviewsConfirm', 'Remove every cached preview card? They are fetched again when next needed.'), { confirmLabel: this.t('config.confirmClear', 'Clear') })) return;
        const endWait = this.beginWait(this.t('config.waitClearPreviewsTitle', 'Clearing link previews…'), this.t('config.waitClearPreviewsStatus', 'Removing every cached card'));
        try {
            const res = await this.writeFetch('/api/previews/clear', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.clearAllPreviewsDone', 'Link previews cleared.'), 'success');
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.clearAllPreviewsError', 'Could not clear the link previews.'), 'error');
        } finally {
            endWait();
        }
    },

    /**
     * Give the disk back without giving up the pictures: the server keeps each
     * source address, so every image returns on its next hover.
     */
    async clearPreviewImages() {
        if (!await this.confirmAction(
            this.t('config.clearPreviewImagesConfirm', 'Remove every cached preview image? They are fetched again when next needed.'),
            { confirmLabel: this.t('config.confirmClear', 'Clear') })) return;
        const endWait = this.beginWait(this.t('config.waitClearImagesTitle', 'Removing cached images…'), this.t('config.waitClearImagesStatus', 'Deleting the files from disk'));
        try {
            const res = await this.writeFetch('/api/previews/images/clear', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.clearPreviewImagesDone', 'Cached images removed.'), 'success');
            await this.refreshPreviewImageStats();
        } catch {
            this.notify(this.t('config.clearPreviewImagesError', 'Could not remove the cached images.'), 'error');
        } finally {
            endWait();
        }
    },

    /**
     * Second gate for the irreversible actions: the reader has to type a word
     * before the confirm button does anything. The token is translated, so a
     * Dutch reader types the Dutch word, and matching ignores case and padding.
     * Resolves true only on an exact match; false on cancel, Escape, or a typo.
     */
    confirmTypedAction(message, token, { title, confirmLabel } = {}) {
        const esc = (v) => this.dash.escapeHtml(v);
        document.getElementById('config-confirm-modal')?.remove();
        const heading = title || this.t('config.resetTypeTitle', 'Final confirmation');
        const okLabel = confirmLabel || this.t('config.resetTypeConfirm', 'Confirm reset');
        const cancelLabel = this.t('config.confirmCancel', 'Cancel');
        const inputLabel = this.t('config.resetTypeLabel', 'Confirmation text');
        document.body.insertAdjacentHTML('beforeend', `
            <div id="config-confirm-modal" class="modal-overlay" aria-hidden="false">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="config-confirm-title">
                    <div class="modal-header">
                        <span class="modal-title" id="config-confirm-title">${esc(heading)}</span>
                    </div>
                    <div class="modal-body">
                        <p class="config-confirm-message">${esc(message)}</p>
                        <input type="text" class="config-text config-confirm-input" data-confirm-input
                            autocomplete="off" spellcheck="false" aria-label="${esc(inputLabel)}">
                        <p class="config-field-hint" data-confirm-hint hidden>${esc(this.t('config.resetTypeMismatch', 'That does not match — nothing was changed.'))}</p>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="modal-button" data-confirm="cancel">
                            <span class="modal-button-name">${esc(cancelLabel)}</span>
                        </button>
                        <button type="button" class="modal-button danger" data-confirm="ok" disabled>
                            <span class="modal-button-name">${esc(okLabel)}</span>
                        </button>
                    </div>
                </div>
            </div>`);
        const overlay = document.getElementById('config-confirm-modal');
        requestAnimationFrame(() => overlay.classList.add('show'));
        const previouslyFocused = document.activeElement;
        const wanted = String(token || '').trim().toLocaleUpperCase();

        return new Promise((resolve) => {
            let done = false;
            const input = overlay.querySelector('[data-confirm-input]');
            const okBtn = overlay.querySelector('[data-confirm="ok"]');
            const hint = overlay.querySelector('[data-confirm-hint]');
            const matches = () => String(input.value || '').trim().toLocaleUpperCase() === wanted;
            const finish = (result) => {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
                // aria-modal="true" promises focus stays inside; without a Tab
                // handler it wandered out to the page behind, including on
                // "Reset all data". FocusTrapUtils is what modal.js and search
                // already use.
                else if (e.key === 'Tab') {
                    window.FocusTrapUtils?.trapTabKey?.(e, overlay.querySelector('.modal') || overlay);
                }
            };
            document.addEventListener('keydown', onKey, true);
            // The button stays disabled until the word matches, so there is no
            // way to fire the reset by mistyping and clicking anyway.
            input.addEventListener('input', () => {
                okBtn.disabled = !matches();
                if (hint) hint.hidden = true;
            });
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (matches()) finish(true);
                else if (hint) hint.hidden = false;
            });
            okBtn.addEventListener('click', () => { if (matches()) finish(true); });
            overlay.querySelector('[data-confirm="cancel"]').addEventListener('click', () => finish(false));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
            input.focus();
        });
    },

    dataBackupsTiles() {
        const data = this._backupData;
        const backups = Array.isArray(data?.backups) ? data.backups : [];
        const enabled = Boolean(data?.enabled);
        const newest = backups[0];

        // The outcome of the last scheduled attempt, which is not the same as the
        // newest file: a run that failed leaves the old file exactly where it
        // was, so the tile went on reading "3 days ago · Next in 4 days" while
        // nothing had been written for a month.
        const lastError = String(data?.lastRunError || '').trim();

        return [
            {
                key: 'last-backup',
                tone: lastError ? 'bad' : (newest ? 'good' : 'warn'),
                label: this.t('config.tileLastBackup', 'Last backup'),
                value: newest ? this.formatRelative(newest.createdAt) : this.t('config.backupNone', 'none'),
                // The server computes nextBackupAt and shipped it unread, so the
                // tile could only restate that the feature is on. When the next
                // one runs is the thing worth knowing.
                detail: lastError
                    ? this.t('config.backupLastFailed', 'Last run failed: {error}')
                        .replace('{error}', lastError)
                    : (enabled
                        ? (Date.parse(data?.nextBackupAt || '')
                            ? this.t('config.backupNextAt', 'Next {when}')
                                .replace('{when}', this.formatRelative(data.nextBackupAt))
                            : this.t('config.backupAutoOn', 'Auto-backup on'))
                        : this.t('config.backupAutoOff', 'Auto-backup off')),
            },
            {
                key: 'stored',
                tone: 'neutral',
                label: this.t('config.tileStoredBackups', 'Stored backups'),
                value: backups.length,
                detail: backups.length
                    ? this.formatBytes(backups.reduce((sum, b) => sum + (Number(b.size) || 0), 0))
                    : '',
            },
        ];
    },

    dbInfoButton(key) {
        const esc = (v) => this.dash.escapeHtml(v);
        const label = this.t('config.settingInfoAria', 'More info');
        return `<button type="button" class="config-info-btn" data-db-info="${esc(key)}" aria-haspopup="dialog" aria-label="${esc(label)}" title="${esc(label)}">ℹ</button>`;
    },

    /** Remove every bookmark but keep pages, categories and settings. */
    async deleteAllBookmarks() {
        if (!await this.confirmAction(this.t('config.deleteAllBookmarksConfirm', 'Delete every bookmark? Your pages, categories and settings are kept. This cannot be undone.'))) return;
        const endWait = this.beginWait(this.t('config.waitDeleteBookmarksTitle', 'Deleting bookmarks…'), this.t('config.waitDeleteBookmarksStatus', 'Removing them from every page'));
        try {
            // Same explicit confirmation flag the reset endpoint requires.
            const res = await this.writeFetch('/api/bookmarks/delete-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.deleteAllBookmarksDone', 'All bookmarks deleted.'), 'success');
            await this.dash.loadAllBookmarks?.();
            await this.dash.loadPageBookmarks?.(this.dash.currentPageId, { forceFetch: true });
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.deleteAllBookmarksError', 'Could not delete the bookmarks.'), 'error');
        } finally {
            endWait();
        }
    },

    async deleteBackup(name) {
        const ok = await this.confirmAction(this.t('config.backupDeleteConfirm', 'Delete this backup?'));
        if (!ok) return;
        try {
            const res = await this.writeFetch(`/api/auto-backups?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.backupDeleteSuccess', 'Backup deleted.'), 'success');
            await this.loadBackupData();
        } catch {
            this.notify(this.t('config.backupDeleteError', 'Could not delete the backup.'), 'error');
        }
    },

    /**
     * Save every stored backup, one file at a time.
     *
     * Sequential rather than parallel: three archives of a megabyte or two are
     * three navigations, and browsers throttle a burst of them into silently
     * dropping all but the first. Sequential also means the count in the toast
     * is the number that actually arrived.
     */
    async downloadAllBackups() {
        const backups = Array.isArray(this._backupData?.backups) ? this._backupData.backups : [];
        if (!backups.length) return;
        let saved = 0;
        // One file after another, so the count is the honest progress.
        const counted = (n) => this.t('config.bulkSweepProgress', '{done} of {total}')
            .replace('{done}', String(n)).replace('{total}', String(backups.length));
        this.showProgressOverlay(this.t('config.waitBackupsAllTitle', 'Downloading backups…'), counted(0));
        try {
            for (const [i, backup] of backups.entries()) {
                try {
                    await this.downloadStoredBackup(backup.name, { quiet: true });
                    saved += 1;
                } catch {
                    // Reported in the total below rather than one toast per file.
                }
                window.ProgressOverlay?.update(i + 1, backups.length, counted(i + 1));
            }
        } finally {
            this.hideProgressOverlay();
        }
        this.notify(saved === backups.length
            ? this.t('config.backupDownloadAllDone', 'Saved {n} backups.').replace('{n}', String(saved))
            : this.t('config.backupDownloadAllPartial', 'Saved {n} of {total} backups.')
                .replace('{n}', String(saved)).replace('{total}', String(backups.length)),
            saved === backups.length ? 'success' : 'error');
    },

    async downloadFullBackup() {
        const stamp = new Date().toISOString().replace('T', '_').replace(/\..+/, '').replace(/:/g, '-');
        // The server zips everything first, local copies included -- tens of
        // megabytes before the first byte arrives.
        const endWait = this.beginWait(this.t('config.waitBackupDownloadTitle', 'Making a backup…'),
            this.t('config.waitBackupDownloadStatus', 'Packing up your data for download'));
        let ok;
        try {
            ok = await this.downloadViaBlob('/api/backup', `nextDash-backup-${stamp}.zip`,
                'config.backupError', 'Could not create the backup.');
        } finally {
            endWait();
        }
        if (ok) this.notify(this.t('config.backupCreated', 'Backup downloaded.'), 'success');
    },

    async downloadStoredBackup(name, { quiet = false } = {}) {
        // This endpoint needs no write token, but routing it through the same
        // helper means one download path to keep working rather than two.
        const endWait = quiet ? () => {} : this.beginWait(
            this.t('config.waitBackupFetchTitle', 'Downloading the backup…'), name);
        try {
            return await this.downloadViaBlob(
                `/api/auto-backups/download?name=${encodeURIComponent(name)}`, name,
                'config.autoBackupDownloadError', 'Could not download the backup.');
        } finally {
            endWait();
        }
    },

    async exportBookmarksCSV() {
        const endWait = this.beginWait(this.t('config.waitExportTitle', 'Preparing the export…'), this.t('config.waitExportStatus', 'Collecting your bookmarks'));
        try {
            const [bookmarksRes, pagesRes] = await Promise.all([
                fetch('/api/bookmarks?all=true'),
                fetch('/api/pages'),
            ]);
            if (!bookmarksRes.ok || !pagesRes.ok) throw new Error('fetch failed');
            const bookmarks = await bookmarksRes.json();
            const pages = await pagesRes.json();
            const pageNames = Object.fromEntries(pages.map((p) => [p.id, p.name]));
            const catNames = await this.categoryNamesByPage(pages.map((p) => p.id));

            const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const header = ['Name', 'URL', 'Category', 'Page', 'Shortcut', 'Tags', 'Notes'].map(escape).join(',');
            const rows = (Array.isArray(bookmarks) ? bookmarks : []).map((bm) => [
                escape(bm.name),
                escape(bm.url),
                escape(this.categoryNameFor(catNames, bm)),
                escape(pageNames[bm.pageId] ?? bm.pageId ?? ''),
                escape(bm.shortcut),
                escape(Array.isArray(bm.tags) ? bm.tags.join(', ') : ''),
                escape(bm.note || ''),
            ].join(','));
            const csv = '﻿' + [header, ...rows].join('\r\n');
            const date = new Date().toISOString().slice(0, 10);
            this.triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `nextdash-bookmarks-${date}.csv`);
            this.notify(this.t('config.csvExportSuccess', 'Bookmarks exported.'), 'success');
        } catch {
            this.notify(this.t('config.csvExportError', 'Could not export bookmarks.'), 'error');
        } finally {
            endWait();
        }
    },

    /**
     * Download the collection as a bookmark file every browser can read.
     *
     * Through writeFetch rather than a plain link: the route is behind the
     * write token, and an <a> cannot carry a header — on an install that has
     * one set, a link would download a 401 page named like a bookmark file.
     */
    async exportBookmarksHTML() {
        const endWait = this.beginWait(this.t('config.waitExportTitle', 'Preparing the export…'), this.t('config.waitExportStatus', 'Collecting your bookmarks'));
        try {
            const res = await this.writeFetch('/api/bookmarks/export-html');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const date = new Date().toISOString().slice(0, 10);
            this.triggerDownload(await res.blob(), `nextdash-bookmarks-${date}.html`);
            this.notify(this.t('config.htmlExportSuccess', 'Bookmarks exported.'), 'success');
        } catch {
            this.notify(this.t('config.htmlExportError', 'Could not export the bookmarks.'), 'error');
        } finally {
            endWait();
        }
    },

    async exportSettings() {
        const endWait = this.beginWait(this.t('config.waitExportSettingsTitle', 'Preparing the export…'), this.t('config.waitExportSettingsStatus', 'Collecting your settings'));
        try {
            const res = await this.writeFetch('/api/settings');
            if (!res.ok) throw new Error(res.statusText);
            const settings = await res.json();
            const date = new Date().toISOString().slice(0, 10);
            this.triggerDownload(
                new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }),
                `nextDash-settings-${date}.json`
            );
            this.notify(this.t('config.settingsExportSuccess', 'Settings exported.'), 'success');
        } catch {
            this.notify(this.t('config.settingsExportError', 'Could not export settings.'), 'error');
        } finally {
            endWait();
        }
    },

    fillSourcePageSelect(select, selectedId) {
        const pages = this.dash.pages || [];
        select.replaceChildren();

        const create = document.createElement('option');
        create.value = DashboardConfig.SOURCE_NEW_PAGE;
        create.textContent = this.t('config.addNewPageOption', '➕ New page…');
        select.appendChild(create);

        let matched = false;
        pages.forEach((page) => {
            const option = document.createElement('option');
            option.value = String(page.id);
            option.textContent = page.name || String(page.id);
            if (Number(page.id) === Number(selectedId)) {
                option.selected = true;
                matched = true;
            }
            select.appendChild(option);
        });
        // A source pointing at a page that has since been deleted falls back to
        // the one being looked at rather than to the create entry, which would
        // make an ordinary save open a name prompt.
        if (!matched && pages.length) {
            select.value = String(this.dash.currentPageId || pages[0].id);
        }
        return matched;
    },

    /**
     * The stored credential names, for a picker in the widgets tab.
     *
     * Names only. The values live in their own file and no route hands them
     * back, so this can be read without holding a secret in the page.
     */
    /*
     * Which folds are open, across a repaint.
     *
     * <details> keeps its open state in the DOM, and these tabs redraw their
     * whole body -- after a backup runs, after a source imports. Without this
     * the panel someone was working in snapped shut the moment they pressed a
     * button inside it.
     */
    foldIsOpen(key, fallback = false) {
        this._openFolds = this._openFolds || new Set();
        // A deliberate close is remembered too, or a panel that opens by
        // default could never be shut for longer than one repaint.
        if (this._openFolds.has(`!${key}`)) return false;
        return this._openFolds.has(key) || fallback;
    },

    async forgetArchiveKeys() {
        const ok = await this.confirmAction(
            this.t('config.archiveForgetConfirm', 'Forget the archive keys? Pages already captured stay in the archive.'),
            { confirmLabel: this.t('config.archiveForgetBtn', 'Forget keys'), danger: true });
        if (!ok) return;
        try {
            const res = await this.writeFetch('/api/health/archive-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forget: true }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Forgetting switches archiving off on the server; the settings in
            // memory must say so, or the next save turns it back on.
            this.dash.settings.archiveSaveEnabled = false;
            this.notify(this.t('config.archiveForgotten', 'Archive keys forgotten.'), 'success');
            void this.loadArchiveSettings();
        } catch {
            this.notify(this.t('config.archiveSaveError', 'Could not save the archive settings.'), 'error');
        }
    },

    async forgetSource(id) {
        const def = this.sourceDef(id);
        if (!def) return;
        const ok = await this.confirmAction(
            this.t('config.sourceForgetConfirm', 'Forget this token? Imported bookmarks stay where they are.'),
            { confirmLabel: this.t('config.sourceForgetBtn', 'Forget token'), danger: true });
        if (!ok) return;
        try {
            // The token only: the source keeps what it already imported, so a
            // new token does not bring back what was deleted since.
            const res = await this.writeFetch(`/api/sources/${encodeURIComponent(id)}/forget`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.sourceForgotten', 'Token forgotten.'), 'success');
            void this.loadSourceStates();
        } catch {
            this.notify(this.t('config.sourceSaveError', 'Could not save that source.'), 'error');
        }
    },

    /** The exact moment, for the title on a row that shows "15h ago". */
    formatExactTime(iso) {
        const at = Date.parse(iso);
        if (!Number.isFinite(at)) return '';
        try {
            return new Intl.DateTimeFormat(this.dash.settings?.language || undefined,
                { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
        } catch {
            return new Date(at).toISOString();
        }
    },

    handleBackupAction(action) {
        // Fires on intent, not on completion: the destructive ones open a
        // confirm dialog, and how often people back out is exactly what makes
        // these worth measuring. `data-backup-action` is a fixed enum.
        this._trackAction('data-action', { action });
        switch (action) {
            case 'download': this.downloadFullBackup(); break;
            case 'run': void this.runBackupNow(); break;
            case 'import': document.getElementById('config-import-input')?.click(); break;
            case 'html-export': void this.exportBookmarksHTML(); break;
            case 'csv-export': void this.exportBookmarksCSV(); break;
            case 'browser-import': document.getElementById('config-browser-import-input')?.click(); break;
            case 'csv-import': document.getElementById('config-csv-import-input')?.click(); break;
            case 'settings-export': void this.exportSettings(); break;
            case 'settings-import': document.getElementById('config-settings-import-input')?.click(); break;
            case 'reset': void this.resetAllData(); break;
            case 'refresh-favicons': void this.refreshAllFavicons(); break;
            case 'refresh-previews': void this.refreshAllPreviews(); break;
            case 'clear-previews': void this.clearAllPreviews(); break;
            case 'clear-tag-keywords': void this.clearTagKeywords(); break;
            case 'clear-preview-images': void this.clearPreviewImages(); break;
            case 'delete-bookmarks': void this.deleteAllBookmarks(); break;
            case 'download-all': void this.downloadAllBackups(); break;
        }
    },

    handleBackupItem(action, name) {
        if (!name) return;
        switch (action) {
            case 'restore': void this.restoreBackup(name); break;
            case 'download': this.downloadStoredBackup(name); break;
            case 'delete': void this.deleteBackup(name); break;
        }
    },

    async handleTrashAction(action, id) {
        // Selection and search are view state, not server actions.
        if (action === 'reload') { void this.loadTrash(); return; }
        if (action === 'select-all') {
            const data = this._trashData;
            const all = Array.isArray(data?.items) ? data.items : [];
            const query = String(this._trashQuery || '').trim().toLowerCase();
            const shown = query ? all.filter((it) => this.trashItemHaystack(it).includes(query)) : all;
            const current = this._trashSelected instanceof Set ? this._trashSelected : new Set();
            // Selects what is on screen, so a search narrows what "all" means.
            this._trashSelected = current.size >= shown.length
                ? new Set()
                : new Set(shown.map((it) => String(it.id)));
            this.repaintTrashBody();
            return;
        }
        if (action === 'restore-selected') { await this.restoreSelectedTrash(); return; }

        try {
            if (action === 'restore') {
                // The response says what came back: a page restore also has to
                // rebuild the page list and the tabs, which a bookmark does not.
                const result = await window.DashboardTrash.restore(id);
                const kind = result?.kind || 'bookmark';
                if (kind === 'page') {
                    const pagesRes = await fetch('/api/pages');
                    if (pagesRes.ok) {
                        this.dash.pages = await pagesRes.json();
                        this.dash.pageNav?.renderPageNavigation?.();
                    }
                    this.notify(this.t('config.trashPageRestored', 'Page restored.'), 'success');
                } else if (kind === 'category') {
                    this.invalidateBookmarkCategoriesCache(result?.pageId);
                    this.notify(this.t('config.trashCategoryRestored', 'Category restored.'), 'success');
                } else {
                    this.notify(this.t('config.trashRestored', 'Bookmark restored.'), 'success');
                }
                // Whatever came back is back on a page, so the grid behind config
                // is stale until it reloads.
                await this.dash.data?.refreshAfterBookmarkMutation?.({});
            } else if (action === 'delete') {
                const ok = await this.confirmAction(
                    this.t('config.trashDeleteConfirm', 'Delete this bookmark permanently?'),
                    { confirmLabel: this.t('config.trashDeleteForever', 'Delete forever'), danger: true }
                );
                if (!ok) {
                    return;
                }
                await window.DashboardTrash.remove(id);
            } else if (action === 'empty') {
                const ok = await this.confirmAction(
                    this.t('config.trashEmptyConfirm', 'Permanently delete everything in the trash?'),
                    { confirmLabel: this.t('config.trashEmptyBtn', 'Empty trash'), danger: true }
                );
                if (!ok) {
                    return;
                }
                await window.DashboardTrash.empty();
            }
        } catch (error) {
            // The server answers a restore onto a deleted page with a 409 and says
            // so in the body; the bookmark stays in the trash. Collapsing that into
            // the generic message left the one recoverable failure unexplained —
            // the user cannot act on "could not complete that action", but they can
            // act on "the page is gone, make it again or move this somewhere else".
            const message = String(error?.message || '');
            const missingPage = /page no longer exists/i.test(message);
            // A page whose id was handed to a new page cannot come back without
            // overwriting that one, so the restore is refused rather than
            // destructive. Say which case it is.
            const idTaken = /already exists/i.test(message);
            this.notify(
                missingPage
                    ? this.t(
                        'config.trashRestorePageGone',
                        'That bookmark’s page no longer exists. It stays in the trash — recreate the page, then restore it.'
                    )
                    : idTaken
                        ? this.t(
                            'config.trashRestorePageIdTaken',
                            'A different page now uses that page’s slot, so it cannot be restored without replacing it.'
                        )
                        : this.t('config.trashActionError', 'Could not complete that action.'),
                'error',
                (missingPage || idTaken) ? { duration: 9000 } : undefined
            );
        }
        await this.loadTrash();
    },

    async handleWebhookAction(action, form) {
        if (!form) return;
        // Every call below writes, so it has to carry the write token an
        // install can be configured to demand. Plain fetch does not.
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const status = form.querySelector('[data-webhook-status]');
        const say = (text) => { if (status) status.textContent = text; };
        const field = (name) => form.querySelector(`[data-webhook-field="${name}"]`);
        const id = String(field('id')?.value || '').trim();
        if (!id) {
            say(this.t('config.webhookNeedsName', 'Give it a name first.'));
            return;
        }

        if (action === 'delete') {
            const ok = await this.confirmAction(
                this.t('config.webhookDeleteConfirm',
                    'Remove this receiver? Its signing key goes with it, so adding it back means configuring the far side again.'),
                { confirmLabel: this.t('config.webhookDelete', 'Remove'), danger: true }
            );
            if (!ok) return;
            await fetcher(`/api/webhooks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            await this.loadWebhooks();
            return;
        }

        if (action === 'test') {
            say(this.t('config.webhookTesting', 'Sending…'));
            try {
                const res = await fetcher(`/api/webhooks/test?id=${encodeURIComponent(id)}`, { method: 'POST' });
                const data = await res.json();
                // The receiver's own status code, not ours: "it answered 404"
                // is the answer to why nothing arrived, and a bare "failed"
                // is not.
                say(data?.ok
                    ? this.t('config.webhookTestSent', 'Delivered — the receiver accepted it.')
                    : (data?.status
                        ? this.t('config.webhookTestRefused', 'The receiver answered HTTP {n}.').replace('{n}', String(data.status))
                        : (data?.error || this.t('config.webhookTestFailed', 'Could not reach it.'))));
            } catch (err) {
                say(this.t('config.webhookTestFailed', 'Could not reach it.'));
            }
            return;
        }

        const events = Array.from(form.querySelectorAll('[data-webhook-event]'))
            .filter((box) => box.checked)
            .map((box) => box.getAttribute('data-webhook-event'));
        say(this.t('config.webhookSaving', 'Saving…'));
        try {
            const res = await fetcher('/api/webhooks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    url: String(field('url')?.value || '').trim(),
                    events,
                    enabled: field('enabled')?.checked === true,
                }),
            });
            if (!res.ok) {
                say((await res.text()).trim() || this.t('config.webhookSaveFailed', 'Could not save it.'));
                return;
            }
            const data = await res.json();
            this._webhookEndpoints = Array.isArray(data?.endpoints) ? data.endpoints : this._webhookEndpoints;
            // The one moment the key is readable. Shown here rather than in a
            // toast because it has to survive long enough to be copied, and
            // it will never be shown again.
            if (data?.secret) {
                this._webhookNewSecret = { id, secret: data.secret };
            }
            this.repaintWebhooks();
            this.showWebhookSecret();
        } catch (err) {
            say(this.t('config.webhookSaveFailed', 'Could not save it.'));
        }
    },

    /*
     * The archive panel: keys in, never out.
     *
     * Read from /api/health/archive-settings rather than from the settings
     * payload, which carries every credential it holds. Same write-only rule as
     * the import tokens -- an empty field means "keep what is stored", so
     * flipping the switch cannot wipe the keys.
     */
    async loadArchiveSettings() {
        const note = document.getElementById('config-archive-key-note');
        if (!note) return;
        try {
            const res = await this.writeFetch('/api/health/archive-settings');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const state = await res.json();
            note.textContent = state.hasKeys
                ? this.t('config.archiveKeysSet', 'Keys are saved. Leave these empty to keep them.')
                : this.t('config.archiveKeysMissing', 'No keys saved yet.');
            const toggle = document.querySelector('[data-archive-toggle="archiveSaveEnabled"]');
            if (toggle) toggle.checked = Boolean(state.enabled);
        } catch {
            note.textContent = '';
        }
    },

    /** Read every configured source once and fill in each panel. */
    async loadSourceStates() {
        let sources = [];
        try {
            const res = await this.writeFetch('/api/sources');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            sources = Array.isArray(body) ? body : [];
        } catch {
            // Offline or no write access: the panels stay as they are rather
            // than claiming no token is saved, which would be a lie the reader
            // might act on by pasting theirs again.
            return;
        }
        DashboardConfig.SOURCE_DEFS.forEach((def) => {
            this.renderSourceState(def, sources.find((s) => s.id === def.id));
        });
    },

    /** Fetch the trash and repaint the tab, when it is the one showing. */
    async loadTrash({ repaint = true } = {}) {
        try {
            this._trashData = await window.DashboardTrash.list();
            this._trashLoadFailed = false;
        } catch (_error) {
            // Kept apart from a genuinely empty trash — see renderDataTrash.
            this._trashData = { items: [], count: 0, retentionDays: 30 };
            this._trashLoadFailed = true;
        }
        if (!repaint || !this.inSection('data-backups') || this.dbTab !== 'trash') return;
        const body = document.getElementById('config-db-body');
        if (body) {
            body.innerHTML = this.renderDbTab();
            this.bindDataBackupsActions(body);
        }
    },

    async loadWebhooks() {
        try {
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await fetcher('/api/webhooks');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this._webhookEndpoints = Array.isArray(data?.endpoints) ? data.endpoints : [];
            this._webhookEvents = Array.isArray(data?.events) ? data.events : null;
        } catch (err) {
            this._webhookEndpoints = [];
        }
        // The control group is only worth ticking where the server lets
        // containers be acted on; the Containers tab reads the same answer.
        try {
            const res = await fetch('/api/docker/status');
            const status = res.ok ? await res.json() : null;
            this._dockerControl = status?.control === true;
        } catch (err) {
            this._dockerControl = false;
        }
        this.repaintWebhooks();
    },

    openDbInfo(key) {
        const info = DashboardConfig.DB_INFO[key];
        if (!info || !window.AppModal?.alert) return;
        const [titleKey, msgKey, titleFallback, msgFallback] = info;
        window.AppModal.alert({
            title: this.t(`config.${titleKey}`, titleFallback),
            htmlMessage: this.dash.escapeHtml(this.t(`config.${msgKey}`, msgFallback)),
            confirmText: this.t('config.gotIt', 'Got it'),
        });
    },

    /**
     * The cached-image read-out, drawn from whatever the last stats call left
     * behind. Rendered synchronously so the panel never flashes a blank line;
     * refreshPreviewImageStats fills it in and repaints.
     */
    previewImageCacheUsageText() {
        const stats = this._previewImageStats;
        if (!stats) return this.t('config.previewImageCacheUnknown', 'Cached images: counting…');
        return this.t('config.previewImageCacheUsage', '{files} cached images, {used} of {cap}')
            .replace('{files}', String(stats.files || 0))
            .replace('{used}', this.formatBytes(stats.bytes || 0))
            .replace('{cap}', this.formatBytes(stats.capBytes || 0));
    },

    /** Re-download every bookmark favicon across all pages. */
    async refreshAllFavicons() {
        if (!await this.confirmAction(this.t('config.bulkRefreshFaviconsConfirm', 'Download every bookmark icon again? This can take a while on a large dashboard.'), { confirmLabel: this.t('config.confirmContinue', 'Continue'), danger: false })) return;
        // Via ConfigFaviconPrefetch, like the command palette and the quickstart
        // do. Posting to /api/bookmarks/prefetch-icons directly cannot work: the
        // endpoint is per-page and batched, and decodes the request body first,
        // so a body-less POST was rejected with 400 every single time — the
        // button always ended on "Could not refresh the favicons."
        if (typeof window.ConfigFaviconPrefetch !== 'function') {
            this.notify(this.t('config.bulkRefreshFaviconsError', 'Could not refresh the favicons.'), 'error');
            return;
        }
        try {
            const prefetch = new window.ConfigFaviconPrefetch((key) => this.t(key));
            await prefetch.run(null, { refreshAll: true });
            this.notify(this.t('config.bulkRefreshFaviconsDone', 'Favicons refreshed.'), 'success');
            await this.dash.loadAllBookmarks?.();
            this.dash.renderDashboard?.({ animate: false });
        } catch {
            this.notify(this.t('config.bulkRefreshFaviconsError', 'Could not refresh the favicons.'), 'error');
        }
    },

    /** Re-fetch the link-preview card for every bookmark that has one. */
    /*
     * Re-fetch every link preview, in batches, with a real bar.
     *
     * One page fetch per bookmark: measured at 1.3 seconds for eight, so a real
     * collection is minutes. It used to be a single request with no feedback at
     * all -- the button sat there and the app looked hung, and a proxy was free
     * to time the whole thing out halfway through with nothing saved.
     *
     * The bar is determinate because the size is known: the first response says
     * how many there are. An indeterminate sweep here would be throwing away a
     * number we already have.
     */
    async refreshAllPreviews() {
        if (!await this.confirmAction(this.t('config.refreshAllPreviewsConfirm', 'Fetch every link preview card again from its site?'), { confirmLabel: this.t('config.confirmContinue', 'Continue'), danger: false })) return;

        const BATCH = 5;
        // A way out. The bar blocks the page for minutes on a real collection,
        // and a reader who started the sweep by mistake had nothing to do but
        // wait or reload. The round in flight finishes; nothing after it starts.
        let stopped = false;
        this.showProgressOverlay(
            this.t('config.refreshAllPreviewsTitle', 'Refreshing link previews…'),
            this.t('config.refreshAllPreviewsCounting', 'Reading the collection'),
            {
                onCancel: () => { stopped = true; },
                cancelLabel: this.t('config.refreshAllPreviewsStop', 'Stop'),
                cancellingLabel: this.t('config.refreshAllPreviewsStopping', 'Stopping…'),
            });

        let offset = 0;
        let total = 0;
        let refreshed = 0;
        try {
            // Walks until the server says it is done rather than counting
            // rounds here: the collection can change under a long run, and the
            // server's own position is the only one that stays true.
            for (let round = 0; round < 2000; round++) {
                if (stopped) break;
                // A refusal is not a failure: the endpoint shares the
                // sixty-a-minute limiter with the preview and icon fetches, and
                // a sweep of a real collection reaches it. The server says how
                // long to wait, so the round is asked for again rather than the
                // run ending on what it had.
                let res = await this.writeFetch(
                    `/api/previews/refresh?offset=${offset}&limit=${BATCH}`, { method: 'POST' });
                if (res.status === 429) {
                    const retryAfter = Number(res.headers.get('Retry-After')) || 60;
                    window.ProgressOverlay?.update(Math.min(offset, total), total,
                        this.t('config.refreshAllPreviewsWaiting', 'Rate limit reached — waiting {seconds}s')
                            .replace('{seconds}', String(retryAfter)));
                    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
                    if (stopped) break;
                    res = await this.writeFetch(
                        `/api/previews/refresh?offset=${offset}&limit=${BATCH}`, { method: 'POST' });
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = await res.json();

                total = Number(body.total) || total;
                refreshed += Number(body.refreshed) || 0;
                offset = Number(body.next) || offset + BATCH;

                window.ProgressOverlay?.update(Math.min(offset, total), total,
                    this.t('config.refreshAllPreviewsProgress', '{done} of {total}')
                        .replace('{done}', String(Math.min(offset, total)))
                        .replace('{total}', String(total)));

                if (body.done || offset >= total) break;
            }
            if (stopped) {
                // Stopped halfway is not finished: a full bar would say the
                // sweep completed. What it did fetch is saved all the same.
                this.hideProgressOverlay();
                this.notify(this.t('config.refreshAllPreviewsPartial', 'Stopped after {n} of {total}.')
                    .replace('{n}', String(refreshed)).replace('{total}', String(total || refreshed)), 'info');
            } else {
                this.finishProgressOverlay(
                    this.t('config.refreshAllPreviewsDone', 'Link previews refreshed.'));
                this.notify(this.t('config.refreshAllPreviewsDone', 'Link previews refreshed.'), 'success');
            }
        } catch {
            this.hideProgressOverlay();
            // Says how far it got: a run that stopped at 300 of 500 left 300
            // previews genuinely refreshed, and starting over is not required.
            const partial = total
                ? this.t('config.refreshAllPreviewsPartial', 'Stopped after {n} of {total}.')
                    .replace('{n}', String(refreshed)).replace('{total}', String(total))
                : this.t('config.refreshAllPreviewsError', 'Could not refresh the link previews.');
            this.notify(partial, 'error');
        }
    },

    async refreshPreviewImageStats() {
        try {
            const res = await dashFetch('/api/previews/images');
            if (!res.ok) return;
            this._previewImageStats = await res.json();
        } catch {
            // Leave the previous figure standing rather than blanking the line:
            // a failed count is not the same as an empty cache.
            return;
        }
        const el = document.querySelector('[data-testid="preview-image-cache-usage"]');
        if (el) el.textContent = this.previewImageCacheUsageText();
    },

    rememberFold(key, open) {
        this._openFolds = this._openFolds || new Set();
        this._openFolds.delete(open ? `!${key}` : key);
        this._openFolds.add(open ? key : `!${key}`);
    },

    /*
     * Archiving, which is the only outbound source on this tab.
     *
     * It sits here rather than with the importers because it is the same kind
     * of setting -- a third party, a key, something that runs on its own -- but
     * it has no page and no category to choose: nothing arrives, a copy leaves.
     *
     * The keys are archive.org's S3-style pair. Write-only in the same way the
     * import tokens are: the server answers with whether one is stored, never
     * with the value.
     */
    renderArchivePanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        return `
            <details class="config-panel config-source-panel" data-archive-panel
                data-fold="archive" ${this.foldIsOpen('archive') ? 'open' : ''}>
                <summary class="config-source-summary">
                    <span class="config-source-summary-text">
                        <span class="config-panel-title">${esc(this.t('config.archiveSectionTitle', 'Web Archive'))}</span>
                        <span class="config-source-summary-note">${esc(this.t('config.archiveDescription',
                            'Ask the Internet Archive to keep a copy of a page the day you save it, so the bookmark outlives the site. Around 4 in 10 pages from ten years ago are already gone.'))}</span>
                    </span>
                </summary>
                <label class="config-toggle">
                    <input type="checkbox" data-archive-toggle="archiveSaveEnabled" ${s.archiveSaveEnabled ? 'checked' : ''}>
                    <span>${esc(this.t('config.archiveSaveEnabledLabel', 'Archive every new bookmark'))}</span>
                </label>
                <div class="config-field">
                    <label class="config-field-label" for="config-archive-key">${esc(this.t('config.archiveAccessKeyLabel', 'Access key'))}</label>
                    <input type="password" id="config-archive-key" class="config-text" autocomplete="off" spellcheck="false">
                    <p class="config-field-hint">${esc(this.t('config.archiveKeysHelp',
                        'archive.org/account/s3.php — sign in and copy the pair. Without them captures still work, at a far smaller daily allowance.'))}</p>
                    <p class="config-field-hint" id="config-archive-key-note"></p>
                </div>
                <div class="config-field">
                    <label class="config-field-label" for="config-archive-secret">${esc(this.t('config.archiveSecretLabel', 'Secret key'))}</label>
                    <input type="password" id="config-archive-secret" class="config-text" autocomplete="off" spellcheck="false">
                </div>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-archive-action="save">${esc(this.t('config.archiveSaveKeysBtn', 'Save keys'))}</button>
                    <button type="button" class="config-btn" data-archive-action="test">${esc(this.t('config.archiveTestBtn', 'Archive a page now…'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-archive-action="forget">${esc(this.t('config.archiveForgetBtn', 'Forget keys'))}</button>
                </div>
                <p class="config-panel-note" id="config-archive-status"></p>
            </details>
        `;
    },

    renderBackupList() {
        const esc = (v) => this.dash.escapeHtml(v);
        const backups = Array.isArray(this._backupData?.backups) ? this._backupData.backups : [];
        if (this._backupData == null) {
            return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
        }
        if (backups.length === 0) {
            return `<p class="config-panel-empty">${esc(this.t('config.backupListEmpty', 'No stored backups yet.'))}</p>`;
        }
        // The rotation was invisible: the panel counted what exists and said
        // nothing about a fourth pushing the oldest out — which makes "Make a
        // backup now" a destructive button once the rotation is full, and the
        // same is true of the copy taken before a restore.
        const keep = Number(this._backupData?.keep) || 0;
        const note = keep
            ? `<p class="config-panel-note">${esc(this.t('config.backupRotationNote',
                'The newest {keep} are kept. Making another — or restoring, which copies the current data first — removes the oldest.')
                .replace('{keep}', String(keep)))}</p>`
            : '';
        /*
         * Where they are, and whether that is a problem.
         *
         * The panel could say how old the newest backup was and never where it
         * lived, while NEXTDASH_AUTO_BACKUP_DIR sat documented in the README
         * and nowhere in the app. Unset, backups land inside the data directory
         * — and the one failure they exist for takes them with it.
         */
        const dir = String(this._backupData?.dir || '').trim();
        const where = dir
            ? `<p class="config-panel-note">${esc(this.t('config.backupDirLine', 'Stored in {dir}.')
                .replace('{dir}', dir))}</p>`
            : '';
        const inside = dir && this._backupData?.insideDataDir
            ? `<p class="config-panel-note config-panel-note--warn">${esc(this.t(
                'config.backupInsideDataDirWarning',
                'These backups are inside the data directory they back up, so losing it loses them too. '
                + 'Set NEXTDASH_AUTO_BACKUP_DIR to an absolute path elsewhere.'))}</p>`
            : '';
        const rows = backups.map((b) => `
            <li class="config-backup-row">
                <div class="config-backup-meta">
                    <span class="config-backup-name" title="${esc(this.formatExactTime(b.createdAt))}">${esc(this.formatRelative(b.createdAt) || b.name)}</span>
                    <span class="config-backup-size">${esc(this.formatBytes(b.size))}${esc(this.backupContentsLabel(b))}</span>
                </div>
                <div class="config-backup-row-actions">
                    <button type="button" class="config-btn config-btn--small" data-backup-item="restore" data-backup-name="${esc(b.name)}">${esc(this.t('config.autoBackupRestore', 'Restore'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-backup-item="download" data-backup-name="${esc(b.name)}">${esc(this.t('config.backupDownloadOne', 'Download'))}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--danger" data-backup-item="delete" data-backup-name="${esc(b.name)}">${esc(this.t('config.backupDelete', 'Delete'))}</button>
                </div>
            </li>
        `).join('');
        return `${note}${where}${inside}<ul class="config-backup-list">${rows}</ul>
            <div class="config-actions">
                <button type="button" class="config-btn config-btn--small" data-backup-action="download-all">${esc(
                    this.t('config.backupDownloadAll', 'Download all'))}</button>
            </div>`;
    },

    /** The top of Backups & data: is my data safe, and the two buttons that make it so. */
    renderBackupStatus() {
        const esc = (v) => this.dash.escapeHtml(v);
        const data = this._backupData;
        if (data == null) {
            return `<div class="config-panel config-db-status"><p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p></div>`;
        }
        const backups = Array.isArray(data.backups) ? data.backups : [];
        const newest = backups[0];
        const lastError = String(data.lastRunError || '').trim();
        let tone = 'good';
        let headline = this.t('config.dbStatusGood', 'Your data is backed up');
        let detail;
        if (lastError) {
            tone = 'bad';
            headline = this.t('config.dbStatusFailed', 'The last automatic backup failed');
            detail = lastError;
        } else if (!newest) {
            tone = 'warn';
            headline = this.t('config.dbStatusNone', 'No backup yet');
            detail = this.t('config.dbStatusNoneDetail', 'Make one now, or turn on automatic backups below.');
        } else {
            const last = this.t('config.dbStatusLast', 'Last backup {when}.').replace('{when}', this.formatRelative(newest.createdAt));
            const next = data.enabled
                ? (Date.parse(data.nextBackupAt || '')
                    ? this.t('config.dbStatusNext', 'Next one {when}.').replace('{when}', this.formatRelative(data.nextBackupAt))
                    : this.t('config.backupAutoOn', 'Auto-backup on'))
                : this.t('config.dbStatusAutoOff', 'Automatic backups are off.');
            detail = `${last} ${next}`;
        }
        const total = backups.reduce((sum, b) => sum + (Number(b.size) || 0), 0);
        const stat = (label, value) => `<div class="config-db-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
        const stats = [
            stat(this.t('config.dbStatStored', 'Stored'), String(backups.length)),
            stat(this.t('config.dbStatSize', 'Size of the newest'), newest ? this.formatBytes(newest.size) : '-'),
            stat(this.t('config.dbStatDisk', 'On disk'), backups.length ? this.formatBytes(total) : '-'),
            stat(this.t('config.dbStatBookmarks', 'Bookmarks in it'), newest && Number(newest.bookmarks) ? this.statsNumber(Number(newest.bookmarks)) : '-'),
        ].join('');
        const mark = tone === 'good' ? '✓' : '!';
        return `
            <div class="config-panel config-db-status config-db-status--${tone}" data-db-status="${tone}">
                <div class="config-db-status-head">
                    <span class="config-db-status-mark" aria-hidden="true">${mark}</span>
                    <div class="config-db-status-text">
                        <h3 class="config-panel-title">${esc(headline)} ${this.dbInfoButton('status')}</h3>
                        <p class="config-panel-note">${esc(detail)}</p>
                    </div>
                    <div class="config-db-status-actions">
                        <button type="button" class="config-btn config-btn--primary" data-backup-action="run">${esc(this.t('config.backupRunNowShort', 'Back up now'))}</button>
                        <button type="button" class="config-btn" data-backup-action="download">${esc(this.t('config.backupDownloadShort', 'Download'))}</button>
                    </div>
                </div>
                <div class="config-db-stats">${stats}</div>
            </div>`;
    },

    renderDataBackups() {
        const esc = (v) => this.dash.escapeHtml(v);
        const loading = this._backupData == null;
        const tiles = loading
            ? `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`
            : `<div class="config-tiles" role="list">${this.dataBackupsTiles().map((t) => this.renderTile(t)).join('')}</div>`;

        const s = this.dash.settings || {};
        const recheckHours = Number(s.healthAutoRecheckIntervalHours) || 24;
        const intervalOptions = [6, 12, 24, 48, 168].map((h) => {
            const label = h < 24
                ? this.t('config.recheckEveryHours', 'Every {n}h').replace('{n}', String(h))
                : (h === 24
                    ? this.t('config.recheckDaily', 'Daily')
                    : (h === 168
                        ? this.t('config.recheckWeekly', 'Weekly')
                        : this.t('config.recheckEveryDays', 'Every {n} days').replace('{n}', String(h / 24))));
            return `<option value="${h}" ${h === recheckHours ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('');

        const faviconPolicy = s.faviconRefreshPolicy || 'monthly';
        const faviconPolicyOptions = [
            ['never', this.t('config.faviconPolicyNever', 'Never')],
            ['monthly', this.t('config.faviconPolicyMonthly', 'Monthly')],
            ['weekly', this.t('config.faviconPolicyWeekly', 'Weekly')],
            ['always', this.t('config.faviconPolicyAlways', 'Every load')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${v === faviconPolicy ? 'selected' : ''}>${esc(label)}</option>`).join('');

        const tabs = DashboardConfig.DB_TABS.map((tab) => {
            const active = tab === this.dbTab;
            return `<button type="button" class="config-subtab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" aria-controls="config-db-body" data-db-tab="${esc(tab)}">${esc(this.dbTabLabel(tab))}</button>`;
        }).join('');
        return `
            <p class="config-view-intro">${esc(this.t('config.dataBackupsIntro', 'Keep your data safe, move it in and out, and manage what nextDash stores on this disk.'))}</p>
            <div class="config-subtabs" role="tablist">${tabs}</div>
            ${this.renderSectionTabNote('data-backups', this.dbTab)}
            <div id="config-db-body" role="tabpanel" tabindex="0">${this.renderDbTab()}</div>
        `;
    },

    renderDataBackupsMain() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        // Weekly is the default the server falls back to, and 0 is how an install
        // that never chose says so — the option carries that value rather than 7
        // so an untouched setting stays untouched.
        const backupIntervalDays = Number(s.autoBackupIntervalDays) || 0;
        const backupIntervalOptions = [[1, this.t('config.backupEveryDay', 'Every day')],
            [7, this.t('config.backupEveryWeek', 'Every week')],
            [14, this.t('config.backupEveryTwoWeeks', 'Every two weeks')],
            [30, this.t('config.backupEveryMonth', 'Every month')]]
            .map(([days, label]) => {
                const selected = days === (backupIntervalDays || 7);
                return `<option value="${days}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
            }).join('');

        const toggle = (name, checked, label, infoKey, extra = '') => `
            <div class="config-db-toggle">
                <label class="config-toggle">
                    <input type="checkbox" data-backup-toggle="${name}" ${checked ? 'checked' : ''}>
                    <span>${esc(label)}</span>
                </label>
                ${this.dbInfoButton(infoKey)}
                ${extra}
            </div>`;
        const row = (title, infoKey, note, actions) => `
            <div class="config-db-row">
                <div class="config-db-row-text">
                    <b>${esc(title)}${infoKey ? ` ${this.dbInfoButton(infoKey)}` : ''}</b>
                    <span>${esc(note)}</span>
                </div>
                <div class="config-db-row-actions">${actions}</div>
            </div>`;
        const btn = (action, label) => `<button type="button" class="config-btn" data-backup-action="${action}">${esc(label)}</button>`;

        return `
            ${this.renderBackupStatus()}

            <h3 class="config-db-group">${esc(this.t('config.dbGroupProtect', 'Protect'))}</h3>
            <div class="config-panel">
                ${toggle('autoBackupEnabled', s.autoBackupEnabled, this.t('config.autoBackupEnabledLabel', 'Create a backup automatically'), 'auto',
                    `<select class="config-select config-db-interval" aria-label="${esc(this.t('config.autoBackupIntervalLabel', 'How often'))}" data-backup-select="autoBackupIntervalDays" ${s.autoBackupEnabled ? '' : 'disabled'}>${backupIntervalOptions}</select>`)}
                ${toggle('backupIncludeArchives', !s.backupExcludeArchives, this.t('config.backupIncludeArchivesLabel', 'Local copies of pages'), 'archives')}
                ${toggle('backupIncludeSecrets', !s.backupExcludeSecrets, this.t('config.backupIncludeSecretsLabel', 'Tokens and passwords'), 'secrets')}
            </div>

            <h3 class="config-db-group">${esc(this.t('config.dbGroupRestore', 'Restore'))}</h3>
            <div class="config-panel">
                ${row(this.t('config.dbRestoreFile', 'From a file'), 'restoreFile',
                    this.t('config.backupsZipSummary', 'Put an earlier backup back. What it contains replaces what is here.'),
                    btn('import', this.t('config.backupImport', 'Import backup…')))}
                <div class="config-db-stored">
                    <p class="config-db-stored-title">${esc(this.t('config.backupStoredTitle', 'Stored backups'))} ${this.dbInfoButton('restoreStored')}</p>
                    <div id="config-backup-list">${this.renderBackupList()}</div>
                </div>
                <input type="file" id="config-import-input" accept=".zip" hidden>
            </div>

            <h3 class="config-db-group">${esc(this.t('config.dbGroupMove', 'Move'))}</h3>
            <div class="config-panel">
                ${row(this.t('config.dbMoveBookmarks', 'Bookmarks'), 'bookmarks',
                    this.t('config.dbMoveBookmarksNote', 'To or from a browser, or a spreadsheet.'),
                    btn('html-export', this.t('config.htmlExportBtn', 'Export bookmarks (HTML)'))
                    + btn('csv-export', this.t('config.csvExportBtn', 'Export bookmarks (CSV)'))
                    + btn('csv-import', this.t('config.csvImportBtn', 'Import bookmarks (CSV)'))
                    + btn('browser-import', this.t('config.browserImportBtn', 'Import browser bookmarks…')))}
                ${row(this.t('config.settingsSection', 'Settings'), 'settings',
                    this.t('config.settingsExportDescription', 'Move just your settings between instances as a JSON file.'),
                    btn('settings-export', this.t('config.settingsExportBtn', 'Export settings (JSON)'))
                    + btn('settings-import', this.t('config.settingsImportBtn', 'Import settings…')))}
                <input type="file" id="config-browser-import-input" accept=".html,.htm" hidden>
                <input type="file" id="config-csv-import-input" accept=".csv,text/csv" hidden>
                <input type="file" id="config-settings-import-input" accept=".json" hidden>
            </div>
        `;
    },

    /**
     * Favicon and link-preview upkeep.
     *
     * Its own tab rather than the tail of Backups & data: none of it is about
     * backing up or moving data, and the two bulk refreshes walk every bookmark,
     * so they are better off out of reach of someone scrolling to the export
     * buttons.
     */
    renderDataIcons() {
        const esc = (v) => this.dash.escapeHtml(v);
        const s = this.dash.settings || {};
        const faviconPolicy = s.faviconRefreshPolicy || 'monthly';
        const faviconPolicyOptions = [
            ['never', this.t('config.faviconPolicyNever', 'Never')],
            ['monthly', this.t('config.faviconPolicyMonthly', 'Monthly')],
            ['weekly', this.t('config.faviconPolicyWeekly', 'Weekly')],
            ['always', this.t('config.faviconPolicyAlways', 'Every load')],
        ].map(([v, label]) => `<option value="${esc(v)}" ${v === faviconPolicy ? 'selected' : ''}>${esc(label)}</option>`).join('');

        // A cap is a disk-space decision, not a dial, so it is a short list.
        // The server refuses anything else and falls back to 200.
        const previewCacheMB = Number(s.previewImageCacheMB) || 200;
        const previewCacheSizeOptions = [50, 200, 500]
            .map((mb) => `<option value="${mb}" ${mb === previewCacheMB ? 'selected' : ''}>${esc(this.formatBytes(mb * 1024 * 1024))}</option>`)
            .join('');

        return `
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.iconsSectionTitle', 'Icons & previews'))}</h3>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.faviconRefreshPolicyLabel', 'Refresh favicons'))}</span>
                    <select class="config-select" data-backup-select="faviconRefreshPolicy">${faviconPolicyOptions}</select>
                    ${this.renderFieldAffordances('faviconRefreshPolicy', s.faviconRefreshPolicy) ? `<span class="config-field-affordances">${this.renderFieldAffordances('faviconRefreshPolicy', s.faviconRefreshPolicy)}</span>` : ''}
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.previewImageCacheSizeLabel', 'Image cache size'))}</span>
                    <select class="config-select" data-backup-select="previewImageCacheMB">${previewCacheSizeOptions}</select>
                </div>
                <p class="config-panel-note">${esc(this.t('config.bookmarkPreviewMaintenanceHint', 'Link preview cards are fetched once and cached. Refresh them all after a site redesign, or clear them to free space.'))}</p>
                <p class="config-panel-note" data-testid="preview-image-cache-usage">${esc(this.previewImageCacheUsageText())}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-backup-action="refresh-favicons">${esc(this.t('config.bulkRefreshFaviconsBtn', 'Refresh all favicons'))}</button>
                    <button type="button" class="config-btn" data-backup-action="refresh-previews">${esc(this.t('config.refreshAllPreviewsBtn', 'Refresh all link previews'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="clear-previews">${esc(this.t('config.clearAllPreviewsBtn', 'Clear all link previews'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-testid="clear-preview-images" data-backup-action="clear-preview-images">${esc(this.t('config.clearPreviewImagesBtn', 'Remove cached images'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="clear-tag-keywords">${esc(this.t('config.clearTagKeywordsBtn', 'Forget the scanned keywords'))}</button>
                </div>
            </div>
        `;
    },

    /**
     * The destructive actions, kept on their own tab so they cannot be hit while
     * scrolling through backup settings. Both ask twice, and the full reset also
     * makes you type the confirmation word.
     */
    renderDataReset() {
        const esc = (v) => this.dash.escapeHtml(v);
        const token = this.t('config.resetTypeToken', 'RESET');
        return `
            <p class="config-view-intro">${esc(this.t('config.resetIntro', 'These actions permanently remove data. Make a backup first — there is no undo.'))}</p>

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.deleteAllBookmarksTitle', 'Delete all bookmarks'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.deleteAllBookmarksHint', 'Removes every bookmark but keeps your pages, categories, and settings.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="delete-bookmarks">${esc(this.t('config.deleteAllBookmarksBtn', 'Delete all bookmarks only'))}</button>
                </div>
            </div>

            <div class="config-panel config-panel--danger">
                <h3 class="config-panel-title">${esc(this.t('config.resetSectionTitle', 'Reset all data'))}</h3>
                <p class="config-panel-note">${esc(this.t('config.backupResetNote', 'Removes every bookmark, page, and setting. This cannot be undone.'))}</p>
                <p class="config-panel-note">${esc(this.t('config.resetTypeNote', 'You will be asked to type {token} to confirm.').replace('{token}', token))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn config-btn--danger" data-backup-action="reset">${esc(this.t('config.backupReset', 'Reset all data'))}</button>
                </div>
            </div>
        `;
    },

    /** Everything nextDash can pull bookmarks in from, on repeat. */
    renderDataSources() {
        const esc = (v) => this.dash.escapeHtml(v);
        const panels = DashboardConfig.SOURCE_DEFS.map((def) => this.renderSourcePanel(def)).join('');
        /*
         * The promise this tab makes, drawn once at the top.
         *
         * "Previews what it would do before it writes" is the sentence people
         * need to believe before pasting a token into a box, and a sentence is
         * a poor place to make that argument. Three chips and two arrows say it
         * in the shape it happens in.
         */
        const flow = window.SettingArt?.render?.('flow', [
            this.t('config.sourcesArtService', 'A service'),
            this.t('config.sourcesArtPreview', 'Preview'),
            this.t('config.sourcesArtPage', 'Your page'),
        ], 'config-view-intro-art') || '';
        return `
            <div class="config-view-intro-row">
                <p class="config-view-intro">${esc(this.t('config.sourcesIntro',
                    'Services you can bring bookmarks in from. Every import previews what it would do before it writes, and can be run again later to pick up what is new.'))}</p>
                ${flow}
            </div>
            ${panels}
            ${this.renderArchivePanel()}
            ${this.renderLocalArchivePanel()}
        `;
    },

    /**
     * Deleted bookmarks, restorable until they age out.
     *
     * Lives beside Reset because both are about data that is on its way out;
     * this is the one that can still be taken back.
     */
    renderDataTrash() {
        const esc = (v) => this.dash.escapeHtml(v);
        const data = this._trashData;

        if (data == null) {
            return `<p class="config-view-loading">${esc(this.t('config.trashLoading', 'Loading…'))}</p>`;
        }

        const days = Number(data.retentionDays) || 30;
        const intro = this.t(
            'config.trashIntro',
            'Deleted bookmarks stay here for {days} days, then go for good.'
        ).replace('{days}', String(days));

        // A failed load is not an empty trash. Saying "the trash is empty" when
        // the server could not be reached is the one message that stops someone
        // from trying to recover what they just lost.
        if (this._trashLoadFailed) {
            return `
                <p class="config-view-intro">${esc(intro)}</p>
                <p class="config-panel-empty">${esc(this.t('config.trashLoadFailed',
                    'The trash could not be loaded.'))}</p>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-trash-action="reload">${esc(this.t('config.trashRetry', 'Try again'))}</button>
                </div>`;
        }

        const allItems = Array.isArray(data.items) ? data.items : [];
        if (!allItems.length) {
            return `
                <p class="config-view-intro">${esc(intro)}</p>
                <p class="config-panel-empty">${esc(this.t('config.trashEmpty', 'The trash is empty.'))}</p>
            `;
        }

        // Deleting twenty bookmarks in one bulk action and restoring them one
        // by one, from a list that holds up to 500 with no way to search, is
        // the case this view is for — and the only screen where the user is
        // under time pressure.
        const query = String(this._trashQuery || '').trim().toLowerCase();
        const items = query ? allItems.filter((it) => this.trashItemHaystack(it).includes(query)) : allItems;
        const selected = this._trashSelected instanceof Set ? this._trashSelected : new Set();

        const toolbar = `
            <div class="config-pt-toolbar">
                <input type="search" class="config-text" data-trash-search
                       value="${esc(this._trashQuery || '')}"
                       placeholder="${esc(this.t('config.trashSearchPlaceholder', 'Search the trash…'))}"
                       aria-label="${esc(this.t('config.trashSearchPlaceholder', 'Search the trash…'))}">
                <span class="config-field-hint">${esc(this.t('config.trashShowing', '{n} of {total}')
                    .replace('{n}', String(items.length)).replace('{total}', String(allItems.length)))}</span>
            </div>`;

        if (!items.length) {
            return `
                <p class="config-view-intro">${esc(intro)}</p>
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.trashTitle', 'Deleted items'))}</h3>
                    ${toolbar}
                    <p class="config-panel-empty">${esc(this.t('config.trashNoMatches', 'Nothing here matches that search.'))}</p>
                </div>`;
        }

        const rows = items.map((item) => {
            // A trash entry is a bookmark, a whole page, or a category. Older
            // entries predate the kind field and are always bookmarks.
            const kind = item.kind || 'bookmark';
            let name = String(item.bookmark?.name || item.bookmark?.url || '').trim();
            let url = String(item.bookmark?.url || '').trim();
            if (kind === 'page') {
                const count = Number(item.trashedPage?.bookmarks?.length) || 0;
                name = String(item.trashedPage?.page?.name || item.pageName || '').trim();
                // Say what comes back with it: restoring a page is not the same
                // size of action as restoring one bookmark.
                url = this.t('config.trashPageContents', 'Page · {n} bookmarks')
                    .replace('{n}', String(count));
            } else if (kind === 'category') {
                name = String(item.trashedCategory?.category?.name
                    || item.trashedCategory?.category?.id || '').trim();
                url = this.t('config.trashCategoryLabel', 'Category');
            }
            const origin = item.pageName && kind !== 'page'
                ? this.t('config.trashFromPage', 'from {page}').replace('{page}', item.pageName)
                : '';
            return `
                <li class="config-backup-row">
                    <label class="config-toggle config-trash-select">
                        <input type="checkbox" data-trash-select="${esc(item.id)}" ${selected.has(String(item.id)) ? 'checked' : ''}
                               aria-label="${esc(this.t('config.trashSelectItem', 'Select {name}').replace('{name}', name))}">
                    </label>
                    <div class="config-backup-meta">
                        <span class="config-backup-name">${esc(name)}</span>
                        <span class="config-backup-size">${esc(url)}</span>
                        <span class="config-backup-size">${esc([this.formatRelative(new Date(Number(item.deletedAt) || 0).toISOString()), origin].filter(Boolean).join(' · '))}</span>
                    </div>
                    <div class="config-backup-row-actions">
                        <button type="button" class="config-btn" data-trash-action="restore" data-trash-id="${esc(item.id)}">${esc(this.t('config.trashRestore', 'Restore'))}</button>
                        <button type="button" class="config-btn config-btn--danger" data-trash-action="delete" data-trash-id="${esc(item.id)}">${esc(this.t('config.trashDeleteForever', 'Delete forever'))}</button>
                    </div>
                </li>
            `;
        }).join('');

        return `
            <p class="config-view-intro">${esc(intro)}</p>
            <div class="config-panel">
                <h3 class="config-panel-title">${esc(this.t('config.trashTitle', 'Deleted items'))}</h3>
                ${toolbar}
                <ul class="config-backup-list">${rows}</ul>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-trash-action="select-all">${esc(
                        selected.size >= items.length
                            ? this.t('config.trashSelectNone', 'Select none')
                            : this.t('config.trashSelectAll', 'Select all'))}</button>
                    <button type="button" class="config-btn" data-trash-action="restore-selected"${selected.size ? '' : ' disabled'}>${esc(
                        this.t('config.trashRestoreSelected', 'Restore selected ({n})').replace('{n}', String(selected.size)))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-trash-action="empty">${esc(this.t('config.trashEmptyBtn', 'Empty trash'))}</button>
                </div>
            </div>
        `;
    },

    /*
     * Where nextDash pushes to, as opposed to where it pulls from.
     *
     * Sources answer "what did that service add"; a webhook answers the same
     * question the other way round, for whatever somebody built around this
     * install -- an n8n flow, a Home Assistant automation, a script. Without
     * it, anything downstream has to poll, which is the reason this sits
     * beside Sources rather than under the alert settings: those send a
     * message to a person, these send an event to a program.
     */
    renderDataWebhooks() {
        const esc = (v) => this.dash.escapeHtml(v);
        const rows = (this._webhookEndpoints || []).map((e) => this.renderWebhookRow(e)).join('');
        const empty = `<p class="config-view-loading">${esc(this.t('config.webhooksEmpty',
            'Nothing is listening yet.'))}</p>`;
        return `
            <div class="config-view-intro-row">
                <p class="config-view-intro">${esc(this.t('config.webhooksIntro',
                    'Push an event to another program the moment it happens here — a bookmark added, changed or removed, a monitored bookmark going down or coming back. Every delivery is signed, so the receiver can tell it came from this install.'))}</p>
                ${window.SettingArt?.render?.('boundary', {
                    label: 'nextDash',
                    inside: [this.t('config.webhooksArtAdded', 'Added'), this.t('config.webhooksArtDown', 'Down')],
                    out: this.t('config.webhooksArtReceiver', 'Your receiver'),
                }, 'config-view-intro-art') || ''}
            </div>
            <div class="config-webhook-list">${rows || empty}</div>
            ${this.renderMCPPanel()}
            <details class="config-panel config-source-panel"
                data-fold="webhook-new" ${this.foldIsOpen('webhook-new') ? 'open' : ''}>
                <summary class="config-source-summary">
                    <span class="config-source-summary-text">
                        <span class="config-panel-title">${esc(this.t('config.webhookAddTitle', 'Add a receiver'))}</span>
                        <span class="config-source-summary-note">${esc(this.t('config.webhookAddNote',
                            'The address to post to, and what it should hear about.'))}</span>
                    </span>
                </summary>
                ${this.renderWebhookForm(null)}
            </details>
        `;
    },

    /** Which sub-tab of Data & backups is showing. */
    renderDbTab() {
        if (this.dbTab === 'reset') {
            return this.renderDataReset();
        }
        if (this.dbTab === 'trash') {
            return this.renderDataTrash();
        }
        if (this.dbTab === 'sources') {
            return this.renderDataSources();
        }
        if (this.dbTab === 'webhooks') {
            return this.renderDataWebhooks();
        }
        if (this.dbTab === 'icons') {
            // The figure is fetched rather than held in settings, so the panel
            // draws with whatever it had and fills the line in when it lands.
            void this.refreshPreviewImageStats();
            return this.renderDataIcons();
        }
        return this.renderDataBackupsMain();
    },

    /*
     * Copies on this disk, through monolith.
     *
     * Beside the Web Archive panel because they answer the same question and
     * answer it differently: one asks a third party to keep a copy for decades,
     * the other keeps one here that nobody else has to stay online for. Neither
     * replaces the other, which is why both are offered rather than a single
     * "archiving" switch.
     */
    renderLocalArchivePanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <details class="config-panel config-source-panel" data-local-archive-panel
                data-fold="local-archive" ${this.foldIsOpen('local-archive') ? 'open' : ''}>
                <summary class="config-source-summary">
                    <span class="config-source-summary-text">
                        <span class="config-panel-title">${esc(this.t('config.localArchiveTitle', 'Local copies'))}</span>
                        <span class="config-source-summary-note">${esc(this.t('config.localArchiveDescription',
                            'Save a whole page — text, styling and images — as one file in your data directory, so it stays readable even if the site and the Web Archive are both gone.'))}</span>
                    </span>
                </summary>
                <p class="config-panel-note" id="config-local-archive-state"></p>
                <div class="config-field">
                    <label class="config-field-label" for="config-local-archive-url">${esc(this.t('config.localArchiveUrlLabel', 'Page to save'))}</label>
                    <input type="url" id="config-local-archive-url" class="config-text" autocomplete="off" spellcheck="false"
                        placeholder="https://…">
                    <p class="config-field-hint">${esc(this.t('config.localArchiveUrlHint',
                        'Any bookmark can also be saved from its own menu; this is for a page you have in hand.'))}</p>
                </div>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-local-archive-action="capture">${esc(this.t('config.localArchiveCaptureBtn', 'Save a copy…'))}</button>
                    <button type="button" class="config-btn" data-local-archive-action="refresh">${esc(this.t('config.localArchiveRefreshBtn', 'Refresh list'))}</button>
                </div>
                <div id="config-local-archive-list" class="config-local-archives"></div>
            </details>
        `;
    },

    /*
     * The other direction a program can talk to this install: an MCP client
     * reading and adding bookmarks.
     *
     * On this tab rather than a settings panel of its own because the question
     * it answers is the same one the webhooks above answer -- how does another
     * program reach this -- and splitting the two would mean looking in two
     * places for it.
     */
    renderMCPPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const on = this.dash.settings?.mcpEnabled === true;
        // The in-app assistant draws on the same tool groups, so they can be
        // ticked when either the endpoint or the assistant is on.
        const assistantOn = this.dash.settings?.aiEnabled === true;
        const address = `${window.location.origin}/mcp`;
        const needsToken = this.t('config.mcpNeedsToken', 'needs write token');
        const dockerOn = this._dockerControl === true;
        const groups = [
            { key: 'mcpBookmarksWrite', label: 'Bookmarks: edit and delete', labelKey: 'mcpGroupBookmarksWrite',
                note: 'Change or remove bookmarks you have filed.', noteKey: 'mcpGroupBookmarksWriteNote', write: true },
            { key: 'mcpHealthInbox', label: 'Health and Inbox: read', labelKey: 'mcpGroupHealthInbox',
                note: 'See which links are broken and what is waiting in the Inbox.', noteKey: 'mcpGroupHealthInboxNote' },
            { key: 'mcpContainersRead', label: 'Containers: read', labelKey: 'mcpGroupContainersRead',
                note: 'See the containers and their state. Their logs need the write token when one is set.', noteKey: 'mcpGroupContainersReadNote' },
        ];
        const control = {
            key: 'mcpContainersControl', label: 'Containers: control', labelKey: 'mcpGroupContainersControl',
            note: 'Can start, stop, update and remove containers.', noteKey: 'mcpGroupContainersControlNote', write: true,
            blocked: !dockerOn,
            blockedNote: 'Docker control is off on this server (NEXTDASH_DOCKER_CONTROL).', blockedKey: 'mcpControlOff',
        };
        const group = (g) => {
            const off = !(on || assistantOn) || g.blocked === true;
            return `
                <label class="config-toggle">
                    <input type="checkbox" data-backup-toggle="${g.key}" ${this.dash.settings?.[g.key] === true ? 'checked' : ''} ${off ? 'disabled' : ''}>
                    <span>${esc(this.t(`config.${g.labelKey}`, g.label))}${g.write ? ` <small class="config-field-note">(${esc(needsToken)})</small>` : ''}</span>
                </label>
                <p class="config-field-hint">${esc(this.t(`config.${g.noteKey}`, g.note))}${g.blocked ? ` ${esc(this.t(`config.${g.blockedKey}`, g.blockedNote))}` : ''}</p>`;
        };
        return `
            <details class="config-panel config-source-panel"
                data-fold="mcp" ${this.foldIsOpen('mcp') ? 'open' : ''}>
                <summary class="config-source-summary">
                    <span class="config-source-summary-text">
                        <span class="config-panel-title">${esc(this.t('config.mcpTitle', 'MCP access'))}</span>
                        <span class="config-source-summary-note">${esc(this.t('config.mcpSummary',
                            'Let a script or another tool search your bookmarks and add new ones, with more tools you can switch on.'))}</span>
                    </span>
                </summary>
                <p class="config-panel-note">${esc(this.t('config.mcpNote',
                    'A tool that speaks MCP can search this collection, look one bookmark up and add another. It reads everything you have filed here, so it is off until you turn it on. More tools can be switched on below.'))}</p>
                <label class="config-toggle">
                    <input type="checkbox" data-backup-toggle="mcpEnabled" ${on ? 'checked' : ''}>
                    <span>${esc(this.t('config.mcpEnabledLabel', 'Answer MCP clients at this address'))}</span>
                </label>
                ${on ? `
                    <p class="config-field-note">${esc(this.t('config.mcpAddressLabel', 'Give the tool this address:'))}</p>
                    <p class="config-field-note config-mcp-address">${esc(address)}</p>` : ''}
                <p class="config-field-note">${esc(this.t('config.mcpAlwaysOn', 'Searching, looking up and adding bookmarks is always on.'))}</p>
                <p class="config-field-note">${esc(this.t('config.mcpAssistantNote', 'The assistant uses these switches too.'))}</p>
                ${groups.map(group).join('')}
                <p class="config-panel-title">${esc(this.t('config.mcpControlHeading', 'Acting on containers'))}</p>
                ${group(control)}
            </details>
        `;
    },

    /** One source's panel, built from its descriptor. */
    renderSourcePanel(def) {
        const esc = (v) => this.dash.escapeHtml(v);
        const slug = def.slug;
        // Defaults so the two descriptor shapes -- token sources and account
        // sources -- do not each need every field spelled out.
        const needsToken = def.needsToken !== false;

        const handleField = def.needsHandle ? `
                <div class="config-field">
                    <label class="config-field-label" for="config-${esc(slug)}-handle">${esc(this.t(`config.${def.handleLabelKey}`, def.handleLabelFallback))}</label>
                    <input type="text" id="config-${esc(slug)}-handle" class="config-text" autocomplete="off" spellcheck="false"
                        placeholder="${esc(def.handlePlaceholder || '')}">
                </div>` : '';

        const tokenFields = needsToken ? `
                <div class="config-field">
                    <label class="config-field-label" for="config-${esc(slug)}-token">${esc(this.t('config.sourceTokenLabel', 'Access token'))}</label>
                    <input type="password" id="config-${esc(slug)}-token" class="config-text" autocomplete="off" spellcheck="false"
                        placeholder="${esc(def.tokenPlaceholder || '')}">
                    <p class="config-field-hint">${esc(this.t(`config.${def.tokenHelpKey}`, def.tokenHelpFallback))}</p>
                    <p class="config-field-hint" id="config-${esc(slug)}-token-note"></p>
                </div>` : '';

        /*
         * What a feed becomes.
         *
         * Offered only where both answers are defensible. A list of saved items
         * is bookmarks and nothing else; a subscription is one thing followed,
         * and turning its rolling window into rows means new bookmarks for ever.
         */
        const rowsField = def.offersRows ? `
                <label class="config-toggle">
                    <input type="checkbox" data-source-rows="${esc(def.id)}">
                    <span>${esc(this.t('config.sourceAsRows', 'Import each item as its own bookmark'))}</span>
                </label>
                <p class="config-field-hint">${esc(this.t('config.sourceAsRowsHint',
                    'Off: one bookmark to the source itself, which Fresh can then count new items on.'))}</p>` : '';

        /*
         * Folded shut, as <details> rather than a panel of our own.
         *
         * Seven services stacked open is a wall to scroll past before the one
         * you came for, and every one of them shows a token box. Native details
         * carries the keyboard behaviour, the screen-reader semantics and the
         * open state without any of it being reimplemented — and the contents
         * stay in the DOM while closed, so everything that fills these fields
         * goes on working whether or not anyone has opened them.
         */
        return `
            <details class="config-panel config-source-panel" data-source-panel="${esc(def.id)}"
                data-fold="source:${esc(def.id)}" ${this.foldIsOpen(`source:${def.id}`) ? 'open' : ''}>
                <summary class="config-source-summary">
                    <span class="config-source-summary-text">
                        <span class="config-panel-title">${esc(this.t(`config.${def.titleKey}`, def.titleFallback))}</span>
                        <span class="config-source-summary-note">${esc(this.t(`config.${def.descKey}`, def.descFallback))}</span>
                    </span>
                    <span class="config-source-chip" id="config-${esc(slug)}-chip"></span>
                </summary>
                ${handleField}
                ${tokenFields}
                <div class="config-field" data-source-page-field="${esc(def.id)}">
                    <label class="config-field-label" for="config-${esc(slug)}-page">${esc(this.t('config.sourcePageLabel', 'Page to import onto'))}</label>
                    <select id="config-${esc(slug)}-page" class="config-select" data-source-page="${esc(def.id)}"></select>
                </div>
                <div class="config-field">
                    <label class="config-field-label" for="config-${esc(slug)}-category">${esc(this.t('config.sourceCategoryLabel', 'Category for imported bookmarks'))}</label>
                    <input type="text" id="config-${esc(slug)}-category" class="config-text" autocomplete="off"
                        placeholder="${esc(def.categoryFallback)}">
                    <p class="config-field-hint">${esc(this.t('config.sourceCategoryHint', 'Used only for bookmarks the service files nowhere — folders and collections keep their own names.'))}</p>
                </div>
                ${rowsField}
                <div class="config-actions">
                    <button type="button" class="config-btn" data-source-action="save" data-source-id="${esc(def.id)}">${esc(this.t(needsToken ? 'config.sourceSaveBtn' : 'config.sourceSaveSettingsBtn', needsToken ? 'Save token' : 'Save'))}</button>
                    <button type="button" class="config-btn" data-source-action="run" data-source-id="${esc(def.id)}">${esc(this.t('config.sourceRunBtn', 'Import…'))}</button>
                    <button type="button" class="config-btn config-btn--danger" data-source-action="forget" data-source-id="${esc(def.id)}">${esc(this.t(needsToken ? 'config.sourceForgetBtn' : 'config.sourceForgetSettingsBtn', needsToken ? 'Forget token' : 'Forget'))}</button>
                </div>
                <p class="config-panel-note" id="config-${esc(slug)}-status"></p>
            </details>
        `;
    },

    renderSourceState(def, source) {
        const note = document.getElementById(`config-${def.slug}-token-note`);
        const status = document.getElementById(`config-${def.slug}-status`);
        const category = document.getElementById(`config-${def.slug}-category`);
        const pageSelect = document.getElementById(`config-${def.slug}-page`);

        if (pageSelect && source?.targetPage) {
            this.fillSourcePageSelect(pageSelect, source.targetPage);
        }
        // The handle is not secret, so unlike the token it comes back and is
        // shown -- a panel that forgot which account it points at is a panel
        // nobody trusts.
        const handle = document.getElementById(`config-${def.slug}-handle`);
        if (handle && source?.handle && !handle.value) handle.value = source.handle;
        const rows = document.querySelector(`[data-source-rows="${CSS.escape(def.id)}"]`);
        if (rows && source) rows.checked = Boolean(source.asRows);

        /*
         * Only the panels that ask for a token have a line about one.
         *
         * This used to be an early return covering the whole function, so the
         * two sources that need no token -- Hacker News favourites and a
         * YouTube channel -- never had their handle, their page or their last
         * result restored either. The comment above says a panel that forgot
         * which account it points at is a panel nobody trusts; those were
         * exactly the two that forgot.
         */
        if (note) {
            note.textContent = source?.hasToken
                ? this.t('config.sourceTokenSet', 'A token is saved. Leave this empty to keep it.')
                : this.t('config.sourceTokenMissing', 'No token saved yet.');
        }
        if (category && source?.targetCategory && !category.value) {
            category.value = source.targetCategory;
        }
        /*
         * What the folded summary says.
         *
         * A row of seven identical headings tells you nothing about which one
         * you already set up, so the chip carries the one fact that decides
         * whether to open it: never used, ready, or the last attempt failed.
         */
        const chip = document.getElementById(`config-${def.slug}-chip`);
        if (chip) {
            chip.classList.remove('is-ready', 'is-failed');
            if (source?.lastError) {
                chip.classList.add('is-failed');
                chip.textContent = this.t('config.sourceChipFailed', 'last import failed');
            } else if (source?.hasToken || source?.handle) {
                chip.classList.add('is-ready');
                chip.textContent = source?.lastRun
                    ? this.t('config.sourceChipReady', 'set up')
                    : this.t('config.sourceChipNotRunYet', 'set up, never run');
            } else {
                chip.textContent = this.t('config.sourceChipUnused', 'not set up');
            }
        }

        if (!status) return;
        if (source?.lastError) {
            status.textContent = this.t('config.sourceLastError', 'Last attempt failed: {e}')
                .replace('{e}', source.lastError);
        } else if (source?.lastResult) {
            status.textContent = this.t('config.sourceLastRun', 'Last import: {r}')
                .replace('{r}', source.lastResult);
        } else {
            status.textContent = '';
        }
    },

    renderWebhookForm(endpoint) {
        const esc = (v) => this.dash.escapeHtml(v);
        const existing = !!endpoint;
        const id = endpoint?.id || '';
        const selected = endpoint?.events || [];
        const labels = {
            'bookmark.added': this.t('config.webhookEventBookmarkAdded', 'A bookmark is added'),
            'bookmark.updated': this.t('config.webhookEventBookmarkUpdated', 'A bookmark changes'),
            'bookmark.deleted': this.t('config.webhookEventBookmarkDeleted', 'A bookmark is removed'),
            'health.down': this.t('config.webhookEventHealthDown', 'A monitored bookmark goes down'),
            'health.up': this.t('config.webhookEventHealthUp', 'A monitored bookmark comes back'),
            'health.cert-expiring': this.t('config.webhookEventHealthCertExpiring',
                'A TLS certificate is about to expire'),
            'health.domain-expiring': this.t('config.webhookEventHealthDomainExpiring',
                'A domain registration is about to expire'),
        };
        const boxes = (this._webhookEvents || Object.keys(labels)).map((name) => `
            <label class="config-check">
                <input type="checkbox" data-webhook-event="${esc(name)}" ${selected.includes(name) ? 'checked' : ''}>
                <span>${esc(labels[name] || name)}</span>
            </label>`).join('');
        return `
            <div class="config-webhook-form" data-webhook-form="${esc(id)}">
                <div class="config-field">
                    <label class="config-field-label">${esc(this.t('config.webhookIdLabel', 'Name'))}</label>
                    <input type="text" class="config-text" data-webhook-field="id" value="${esc(id)}"
                        ${existing ? 'readonly' : ''} autocomplete="off" spellcheck="false" placeholder="n8n">
                    <p class="config-field-hint">${esc(this.t('config.webhookIdHint',
                        'Letters, digits, dash, underscore, dot and colon. Fixed once saved.'))}</p>
                </div>
                <div class="config-field">
                    <label class="config-field-label">${esc(this.t('config.webhookUrlLabel', 'Address to post to'))}</label>
                    <input type="url" class="config-text" data-webhook-field="url" value="${esc(endpoint?.url || '')}"
                        autocomplete="off" spellcheck="false" placeholder="https://…">
                </div>
                <div class="config-field">
                    <span class="config-field-label">${esc(this.t('config.webhookEventsLabel', 'Send when'))}</span>
                    <div class="config-checkset" role="group">${boxes}</div>
                    <p class="config-field-hint">${esc(this.t('config.webhookEventsHint',
                        'Nothing ticked means everything.'))}</p>
                </div>
                <label class="config-check">
                    <input type="checkbox" data-webhook-field="enabled" ${endpoint?.enabled ? 'checked' : ''}>
                    <span>${esc(this.t('config.webhookEnabledLabel', 'Send to this receiver'))}</span>
                </label>
                <div class="config-actions">
                    <button type="button" class="config-btn" data-webhook-action="save">${esc(this.t('config.webhookSave', 'Save'))}</button>
                    ${existing ? `
                        <button type="button" class="config-btn" data-webhook-action="test">${esc(this.t('config.webhookTest', 'Send a test'))}</button>
                        <button type="button" class="config-btn config-btn--danger" data-webhook-action="delete">${esc(this.t('config.webhookDelete', 'Remove'))}</button>` : ''}
                    <span class="config-field-hint" data-webhook-status></span>
                </div>
                <p class="config-field-hint" data-webhook-secret hidden></p>
            </div>
        `;
    },

    /*
     * One saved receiver, folded shut.
     *
     * The signing key is not in here. It travelled back once, in the answer to
     * the save that generated it, because that is the only moment it can be
     * copied into the far side -- a screen that redisplays it turns every
     * screenshot and every shoulder into a leak.
     */
    renderWebhookRow(endpoint) {
        const esc = (v) => this.dash.escapeHtml(v);
        const name = endpoint.label || endpoint.id;
        const state = endpoint.enabled
            ? this.t('config.webhookStateOn', 'Sending')
            : this.t('config.webhookStateOff', 'Paused');
        return `
            <details class="config-panel config-source-panel" data-webhook-id="${esc(endpoint.id)}"
                data-fold="webhook:${esc(endpoint.id)}" ${this.foldIsOpen(`webhook:${endpoint.id}`) ? 'open' : ''}>
                <summary class="config-source-summary">
                    <span class="config-source-summary-text">
                        <span class="config-panel-title">${esc(name)}</span>
                        <span class="config-source-summary-note">${esc(state)} — ${esc(endpoint.url)}</span>
                    </span>
                </summary>
                ${this.renderWebhookForm(endpoint)}
            </details>
        `;
    },

    /**
     * Redraw just the trash body, keeping the search caret where it was.
     *
     * Typing repaints on every keystroke, so without this the caret jumped to
     * the start of the field after the first character.
     */
    repaintTrashBody({ keepFocus = false } = {}) {
        const body = document.getElementById('config-db-body');
        if (!body) return;
        const search = body.querySelector('[data-trash-search]');
        const caret = keepFocus && search ? search.selectionStart : null;
        body.innerHTML = this.renderDbTab();
        this.bindDataBackupsActions(body);
        if (keepFocus) {
            const next = body.querySelector('[data-trash-search]');
            next?.focus?.();
            if (caret != null) { try { next?.setSelectionRange(caret, caret); } catch { /* ignore */ } }
        }
    },

    /*
     * Only this tab's body is repainted, and only while it is the one on
     * screen: a fetch that lands after the reader has moved on must not
     * replace whatever they opened instead.
     */
    repaintWebhooks() {
        if (!this.inSection('data-backups') || this.dbTab !== 'webhooks') return;
        const body = document.getElementById('config-db-body');
        if (!body) return;
        body.innerHTML = this.renderDbTab();
        this.bindDataBackupsActions(body);
    },

    async resetAllData() {
        const ok = await this.confirmAction(this.t('config.backupResetConfirm', 'Delete ALL data? This cannot be undone.'));
        if (!ok) return;
        // Second gate: the reader types the word before this can fire.
        const token = this.t('config.resetTypeToken', 'RESET');
        const typed = await this.confirmTypedAction(
            this.t('config.resetTypePrompt', 'Type {token} to confirm this permanent reset:').replace('{token}', token),
            token,
        );
        if (!typed) return;
        try {
            // The server rejects a reset without an explicit confirmation flag.
            this.showProgressOverlay(
                this.t('config.backupResetTitle', 'Deleting everything…'),
                this.t('config.backupResetStatus', 'Clearing the data directory'));
            const res = await this.writeFetch('/api/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.notify(this.t('config.backupResetSuccess', 'All data reset. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 800);
        } catch {
            // The overlay holds the scroll lock; left up, the error sat behind
            // it on a page only a reload could leave.
            this.hideProgressOverlay();
            this.notify(this.t('config.backupResetError', 'Could not reset data.'), 'error');
        }
    },

    async restoreBackup(name) {
        const ok = await this.confirmAction(this.t('config.backupRestoreConfirm', 'Restore this backup? Current data will be replaced.'), { confirmLabel: this.t('config.autoBackupRestore', 'Restore') });
        if (!ok) return;
        const endWait = this.beginWait(this.t('config.waitRestoreTitle', 'Restoring the backup…'), this.t('config.waitRestoreStatus', 'Replacing your data with the backup'));
        try {
            const res = await this.writeFetch(`/api/auto-backups/restore?name=${encodeURIComponent(name)}`, { method: 'POST' });
            if (!res.ok) throw Object.assign(new Error(await this.backupFailureReason(res)), { fromServer: true });
            this.notify(this.t('config.autoBackupRestoreSuccess', 'Backup restored. Reloading…'), 'success');
            setTimeout(() => window.location.reload(), 800);
        } catch (err) {
            this.notify(this.withBackupReason(this.t('config.autoBackupRestoreError', 'Failed to restore backup.'), err), 'error');
        } finally {
            endWait();
        }
    },

    /** Restore several entries at once, reporting per-item outcome. */
    async restoreSelectedTrash() {
        const ids = [...(this._trashSelected instanceof Set ? this._trashSelected : new Set())];
        if (!ids.length) return;

        // One at a time rather than one bulk call: the server has no bulk
        // restore endpoint, and a page whose id was reused legitimately refuses
        // — so a single failure must not take the rest of the batch with it.
        const failures = [];
        for (const id of ids) {
            try {
                await window.DashboardTrash.restore(id);
            } catch (error) {
                failures.push(String(error?.message || id));
            }
        }
        const restored = ids.length - failures.length;
        this._trashSelected = new Set();

        const pagesRes = await fetch('/api/pages').catch(() => null);
        if (pagesRes?.ok) {
            this.dash.pages = await pagesRes.json();
            this.dash.pageNav?.renderPageNavigation?.();
        }
        await this.dash.data?.refreshAfterBookmarkMutation?.({});

        if (failures.length) {
            this.notify(this.t('config.trashRestoredSomeFailed',
                'Restored {ok}. {failed} could not be restored and stay in the trash.')
                .replace('{ok}', String(restored)).replace('{failed}', String(failures.length)), 'error');
        } else {
            this.notify(this.t('config.trashRestoredMany', 'Restored {n} items.')
                .replace('{n}', String(restored)), 'success');
        }
        await this.loadTrash();
    },

    async runBackupNow() {
        try {
            /*
             * Indeterminate: the archive is built whole in one request, and how
             * long that takes depends on what goes in it -- with local copies of
             * pages included it is seconds. Nothing moved on screen for that
             * whole time, so the button read as dead and got pressed twice.
             */
            this.showProgressOverlay(
                this.t('config.backupRunTitle', 'Making a backup…'),
                this.t('config.backupRunStatus', 'Packing up your data'));
            const res = await this.writeFetch('/api/auto-backups/run', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.finishProgressOverlay(this.t('config.backupRunSuccess', 'Backup created.'));
            this.notify(this.t('config.backupRunSuccess', 'Backup created.'), 'success');
            await this.loadBackupData();
        } catch {
            this.hideProgressOverlay();
            this.notify(this.t('config.backupRunError', 'Could not create a backup.'), 'error');
        }
    },

    async runSource(id) {
        const def = this.sourceDef(id);
        if (!def) return;
        const url = `/api/sources/${encodeURIComponent(id)}/run`;
        const serviceName = this.t(`config.${def.titleKey}`, def.titleFallback);

        // Nothing to import with. Said plainly rather than as "could not reach
        // that service", which sends the reader looking at their network.
        if (def.needsToken !== false && !await this.sourceHasToken(id)) {
            this.notify(this.t('config.sourceTokenRequired', 'Paste a token first — this source cannot read anything without one.'), 'error');
            document.getElementById(`config-${def.slug}-token`)?.focus();
            return;
        }
        // An account source needs its name instead, and saying which is missing
        // is the difference between a fixable message and a puzzle.
        if (def.needsHandle && !(await this.sourceHandleValue(id))) {
            this.notify(this.t('config.sourceHandleRequired', 'Fill in the account or channel first.'), 'error');
            document.getElementById(`config-${def.slug}-handle`)?.focus();
            return;
        }

        // The preview walks the whole service, so it is itself the slow part --
        // it earns the overlay just as much as the import does.
        this.showProgressOverlay(
            this.t('config.sourceCheckingTitle', 'Checking {s}…').replace('{s}', serviceName),
            this.t('config.sourceCheckingStatus', 'Reading what is there'));

        let preview;
        try {
            const res = await this.writeFetch(url);
            if (res.status === 401) {
                this.hideProgressOverlay();
                this.notify(this.t('config.sourceTokenRejected', 'That token was rejected.'), 'error');
                void this.loadSourceStates();
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            preview = await res.json();
        } catch {
            this.hideProgressOverlay();
            this.notify(this.t('config.sourceRunError', 'Could not reach that service.'), 'error');
            void this.loadSourceStates();
            return;
        }
        this.hideProgressOverlay();

        if (!Number(preview.new)) {
            this.notify(this.t('config.sourceNothingNew', 'Nothing new to import.'), 'info');
            void this.loadSourceStates();
            return;
        }

        /*
         * Which page the bookmarks are going to, named in the confirm.
         *
         * A source keeps the page it was configured with, so an import can land
         * somewhere the reader is not currently looking -- and then it looks
         * like nothing happened. Saying so before it writes is cheaper than
         * explaining it afterwards.
         */
        const targetPage = Number(preview.page) || Number(this.dash.currentPageId) || 1;
        const pageName = (this.dash.pages || []).find((p) => Number(p.id) === targetPage)?.name || '';

        const dest = await this.chooseImportDestination({
            total: preview.new, pageName, onPage: preview, toInbox: preview.inbox,
        });
        if (!dest) return;
        const toInbox = dest === 'inbox';

        this.showProgressOverlay(
            this.t('config.sourceImportingTitle', 'Importing from {s}…').replace('{s}', serviceName),
            this.t('config.sourceImportingStatus', '{n} bookmarks').replace('{n}', String(preview.new)));

        try {
            const res = await this.writeFetch(toInbox ? `${url}?inbox=1` : url, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();
            const imported = result.imported ?? preview.new;
            if (toInbox) {
                this.finishProgressOverlay(this.t('config.importedToInbox', 'Added {n} to the inbox.').replace('{n}', String(imported)));
                this.notify(this.t('config.importedToInbox', 'Added {n} to the inbox.').replace('{n}', String(imported)), 'success');
                await this.dash.inbox?.refreshBadge?.();
                void this.loadSourceStates();
                return;
            }
            this.finishProgressOverlay(
                this.t('config.sourceImported', 'Imported {n} bookmarks.').replace('{n}', String(imported)));
            this.notify(this.t('config.sourceImported', 'Imported {n} bookmarks.')
                .replace('{n}', String(imported)), 'success');
            /*
             * Refresh the page the import actually wrote to, not just the one
             * being looked at. Those are the same only by luck: the target is
             * stored on the source and the reader may have moved pages since.
             * Refreshing only the current page left the target page's cached
             * copy stale, so switching to it showed the collection from before
             * the import -- and its new categories were missing, which is what
             * makes an imported bookmark uneditable.
             */
            const currentPage = Number(this.dash.currentPageId) || targetPage;
            await this.dash.data?.refreshAfterBookmarkMutation?.({
                pageIds: [...new Set([targetPage, currentPage])],
                repaintActiveView: true,
            });
        } catch {
            this.hideProgressOverlay();
            this.notify(this.t('config.sourceRunError', 'Could not reach that service.'), 'error');
        }
        void this.loadSourceStates();
    },

    async saveArchiveSettings({ enabled } = {}) {
        const key = document.getElementById('config-archive-key');
        const secret = document.getElementById('config-archive-secret');
        const toggle = document.querySelector('[data-archive-toggle="archiveSaveEnabled"]');
        try {
            const res = await this.writeFetch('/api/health/archive-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: enabled !== undefined ? enabled : Boolean(toggle?.checked),
                    accessKey: key?.value || '',
                    secret: secret?.value || '',
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const state = await res.json();
            // The settings in memory follow what was stored, or the next
            // ordinary settings save writes the old state back.
            this.dash.settings.archiveSaveEnabled = Boolean(state.enabled);
            // Cleared once stored: a key sitting in a form field is one
            // screenshot away from being shared.
            if (key) key.value = '';
            if (secret) secret.value = '';
            if (enabled === undefined) {
                this.notify(this.t('config.archiveSaved', 'Archive keys saved.'), 'success');
            }
            // Switching it on without keys works, at a much smaller daily
            // allowance -- worth saying rather than letting it look broken.
            if (state.enabled && !state.hasKeys) {
                this.notify(this.t('config.archiveNoKeysWarning',
                    'Archiving is on without keys, which the archive allows at a far smaller daily limit.'), 'info');
            }
            void this.loadArchiveSettings();
        } catch {
            this.notify(this.t('config.archiveSaveError', 'Could not save the archive settings.'), 'error');
        }
    },

    async saveSource(id) {
        const def = this.sourceDef(id);
        if (!def) return;
        const token = document.getElementById(`config-${def.slug}-token`);
        const category = document.getElementById(`config-${def.slug}-category`);
        const chosen = document.getElementById(`config-${def.slug}-page`)?.value;
        const pageId = (chosen && chosen !== DashboardConfig.SOURCE_NEW_PAGE ? Number(chosen) : 0)
            || Number(this.dash.currentPageId) || (this.dash.pages?.[0]?.id) || 1;

        /*
         * An empty field means "keep the stored token" -- but only if there is
         * one. With nothing stored it means the reader has not given one yet,
         * and answering "Source saved." to that is how someone concludes the
         * token was forgotten: the message said it worked.
         */
        // Only where a token is part of the source: Hacker News and YouTube
        // authenticate nothing, so demanding one would block a working setup.
        if (def.needsToken !== false && !token?.value?.trim() && !(await this.sourceHasToken(id))) {
            this.notify(this.t('config.sourceTokenRequired', 'Paste a token first — this source cannot read anything without one.'), 'error');
            token?.focus();
            return;
        }

        try {
            const res = await this.writeFetch(`/api/sources/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: def.kind,
                    label: def.titleFallback,
                    token: token?.value || '',
                    handle: document.getElementById(`config-${def.slug}-handle`)?.value?.trim() || '',
                    asRows: Boolean(document.querySelector(`[data-source-rows="${CSS.escape(def.id)}"]`)?.checked),
                    targetPage: pageId,
                    targetCategory: category?.value?.trim() || '',
                    enabled: true,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Cleared rather than left standing: a token sitting in a form field
            // after it has been saved is one screenshot away from being shared.
            if (token) token.value = '';
            this.sourceTokenDrafts.delete(id);
            this.notify(this.t('config.sourceSaved', 'Source saved.'), 'success');
            void this.loadSourceStates();
        } catch {
            this.notify(this.t('config.sourceSaveError', 'Could not save that source.'), 'error');
        }
    },

    setBackupSelect(name, value) {
        if (name === 'faviconRefreshPolicy') {
            this.dash.settings.faviconRefreshPolicy = value;
            void this.saveSettingsWithFeedback();
            this.repaintBackupSection();
            return;
        }
        if (name === 'autoBackupIntervalDays') {
            this.dash.settings.autoBackupIntervalDays = Number(value) || 0;
            // Saved through the same path as the recheck interval beside it,
            // rather than a patch helper of its own.
            // The tile says when the next one is due, which this changes --
            // read once the new interval is stored.
            void this.saveSettingsWithFeedback().then(() => this.loadBackupData());
            return;
        }
        if (name === 'previewImageCacheMB') {
            this.dash.settings.previewImageCacheMB = Number(value) || 200;
            void this.saveSettingsWithFeedback();
            // The read-out names the cap, so it is now out of date.
            void this.refreshPreviewImageStats();
            return;
        }
        if (name !== 'healthAutoRecheckIntervalHours') return;
        this.dash.settings.healthAutoRecheckIntervalHours = Number(value) || 24;
        void this.saveSettingsWithFeedback();
    },

    setBackupToggle(name, value) {
        const d = this.dash;
        /*
         * The two content switches read as "include" and are stored as
         * "exclude".
         *
         * A settings file written before these existed has neither key, and an
         * absent boolean is false — which on the exclude spelling means the
         * fuller backup, exactly what that install already made. Spelling them
         * as "include" would have every older install quietly start writing
         * thinner backups the day it upgraded.
         */
        if (name === 'backupIncludeArchives' || name === 'backupIncludeSecrets') {
            const field = name === 'backupIncludeArchives' ? 'backupExcludeArchives' : 'backupExcludeSecrets';
            d.settings[field] = !value;
            void this.saveSettingsWithFeedback();
            return;
        }
        // The MCP endpoint stays shut until this is ticked: it answers
        // questions about every bookmark there is, so opening it has to be a
        // decision somebody made.
        if (name === 'mcpEnabled') {
            d.settings.mcpEnabled = value;
            void this.saveSettingsWithFeedback();
            this.repaintWebhooks();
            return;
        }
        // The MCP tool groups: plain booleans, saved as they are ticked.
        if (['mcpBookmarksWrite', 'mcpHealthInbox', 'mcpContainersRead', 'mcpContainersControl'].includes(name)) {
            d.settings[name] = value;
            void this.saveSettingsWithFeedback();
            return;
        }
        if (name === 'autoBackupEnabled' || name === 'healthAutoRecheckEnabled') {
            d.settings[name] = value;
            const saved = this.saveSettingsWithFeedback();
            // Repaint so the interval select enables/disables and the tile updates.
            // After the save: the tile's state is read from the stored settings,
            // and sent alongside, the read usually beat the write.
            if (name === 'autoBackupEnabled') {
                void saved.then(() => this.loadBackupData());
            } else {
                this.repaintBackupSection();
            }
        }
    },

    showWebhookSecret() {
        const pending = this._webhookNewSecret;
        if (!pending) return;
        const panel = document.querySelector(`[data-webhook-id="${CSS.escape(pending.id)}"]`);
        const line = panel?.querySelector('[data-webhook-secret]');
        if (!line) return;
        panel.open = true;
        line.hidden = false;
        line.textContent = this.t('config.webhookSecretOnce',
            'Signing key (shown once — copy it into the receiver now): {key}').replace('{key}', pending.secret);
        this._webhookNewSecret = null;
    },

    /**
     * Import an exported bookmark file.
     *
     * The file goes to the server whole. It used to be parsed here with
     * DOMParser and posted as {name, url, category}, which meant an export
     * carrying tags, notes and dates arrived stripped to three fields — the
     * parser is in Go now (netscape.go) and reads all of them.
     *
     * The count in the confirm comes from a dry run against that same parser,
     * so the number the reader agrees to is the number that will be written,
     * and it can say how many are already here — which a total never could.
     */
    /*
     * One source's four operations: save, preview-then-import, forget, and read
     * back what the server knows.
     *
     * Written against a descriptor rather than per service, because every source
     * in cluster A needs exactly these and differs only in its id and its
     * labels. The token field is write-only throughout: the server answers with
     * hasToken and never the token, so there is nothing to prefill, and an empty
     * field means "leave it as it is" -- which is why saving a category cannot
     * silently sign the reader out of their own source.
     */
    sourceDef(id) {
        return DashboardConfig.SOURCE_DEFS.find((def) => def.id === id) || null;
    },

    /** The account this source is pointed at, as the server has it. */
    async sourceHandleValue(id) {
        const def = this.sourceDef(id);
        const typed = document.getElementById(`config-${def?.slug}-handle`)?.value?.trim();
        if (typed) return typed;
        try {
            const res = await this.writeFetch('/api/sources');
            if (!res.ok) return '';
            const body = await res.json();
            return (Array.isArray(body) ? body : []).find((s) => s.id === id)?.handle || '';
        } catch {
            return '';
        }
    },

    /** Whether the server is holding a token for this source. */
    async sourceHasToken(id) {
        try {
            const res = await this.writeFetch('/api/sources');
            if (!res.ok) return false;
            const body = await res.json();
            return Boolean((Array.isArray(body) ? body : []).find((s) => s.id === id)?.hasToken);
        } catch {
            return false;
        }
    },

    /** Capture one page now, so the keys can be proved before they are relied on. */
    async testArchiveCapture() {
        const target = (this.dash.allBookmarks || [])[0]?.url || 'https://example.com/';
        const status = document.getElementById('config-archive-status');
        this.showProgressOverlay(
            this.t('config.archiveTestingTitle', 'Asking the archive…'),
            this.t('config.archiveTestingStatus', 'Queueing a capture'));
        try {
            const res = await this.writeFetch(`/api/health/archive-save?url=${encodeURIComponent(target)}`, { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            this.hideProgressOverlay();
            if (!res.ok) {
                // The archive's own sentence, which says what to do about it --
                // add keys, wait for the allowance, pick another page.
                const message = body.error || this.t('config.archiveTestError', 'The archive refused that.');
                if (status) status.textContent = message;
                this.notify(message, 'error');
                return;
            }
            const message = body.skipped
                ? this.t('config.archiveTestSkipped', 'That page was already sent to the archive today.')
                : this.t('config.archiveTestQueued', 'Queued. The archive is capturing {u} now.').replace('{u}', target);
            if (status) status.textContent = message;
            this.notify(message, 'success');
        } catch {
            this.hideProgressOverlay();
            this.notify(this.t('config.archiveTestError', 'The archive refused that.'), 'error');
        }
    },

    /** Everything about a trash entry a search should match. */
    trashItemHaystack(item) {
        const kind = item?.kind || 'bookmark';
        const parts = [
            item?.bookmark?.name, item?.bookmark?.url, item?.bookmark?.category,
            item?.pageName, kind,
            item?.trashedPage?.page?.name,
            item?.trashedCategory?.category?.name, item?.trashedCategory?.category?.id,
        ];
        if (Array.isArray(item?.bookmark?.tags)) parts.push(item.bookmark.tags.join(' '));
        return parts.filter(Boolean).join(' ').toLowerCase();
    }

    });

    global.DashboardConfigDataBackupsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
