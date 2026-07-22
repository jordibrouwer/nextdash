/**
 * Quick-start: a lightweight, non-blocking onboarding replacement.
 *
 * Replaces the old step-by-step Onboarding wizard (onboarding.js). Instead of a
 * modal overlay that walks through every screen, it shows:
 *   1. An optional compact setup card (language, theme, link behaviour) on first run.
 *   2. A small dismissible checklist of first tasks that auto-check from dashboard
 *      state (no per-action event hooks — state is re-derived on focus/interval).
 *
 * Completion (finishing the checklist or dismissing it) sets
 * settings.onboardingCompleted = true, the same flag the old wizard persisted.
 */
(function () {
    'use strict';

    const POLL_MS = 4000;

    const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    class QuickStart {
        constructor(dashboard) {
            this.dash = dashboard;
            this.language = dashboard?.language || null;
            this.el = null;
            this.setupEl = null;
            this.pollTimer = null;
            this.focusHandler = null;
            this.completed = new Set();
        }

        t(key, fallback) {
            const full = `quickstart.${key}`;
            if (this.language && typeof this.language.t === 'function') {
                const result = this.language.t(full);
                if (result && result !== full) return result;
            }
            return fallback;
        }

        // Quick-start progress lives server-side in settings.quickStart, so it is
        // consistent across devices (never localStorage).
        state() {
            const d = this.dash;
            if (!d.settings) d.settings = {};
            if (!d.settings.quickStart || typeof d.settings.quickStart !== 'object') {
                d.settings.quickStart = { setupDone: false, dismissed: false, visitedConfig: false, seenCheatsheet: false };
            }
            return d.settings.quickStart;
        }

        persistState() {
            Promise.resolve(this.dash?.saveSettings?.()).catch(() => {});
        }

        // Only first-run installs (onboardingCompleted !== true) see quick-start.
        shouldStart() {
            if (this.dash?.settings?.onboardingCompleted === true) return false;
            if (this.state().dismissed === true) return false;
            return true;
        }

        start() {
            if (!this.shouldStart()) return;
            if (this.shouldShowSetup()) {
                this.renderSetupCard();
            } else {
                this.renderChecklist();
            }
        }

        // ---- Compact setup card (language / theme / link behaviour) ------------

        shouldShowSetup() {
            return this.state().setupDone !== true;
        }

        markSetupDone() {
            this.state().setupDone = true;
            this.persistState();
        }

        // Seed the working draft from current settings so nothing is lost on skip.
        buildDraft() {
            const s = this.dash?.settings || {};
            let cols = parseInt(s.columnsPerRow, 10);
            if (!Number.isFinite(cols) || cols < 1) cols = 3;
            return {
                language: s.language || 'en',
                autoDarkMode: s.autoDarkMode !== false,
                packedColumns: s.packedColumns !== false,
                columnsPerRow: Math.min(Math.max(cols, 1), 8),
                openInNewTab: s.openInNewTab !== false,
                showWeatherWithDate: s.showWeatherWithDate === true,
                weatherSource: s.weatherSource || 'manual',
                weatherLocation: s.weatherLocation || '',
                // "Start from scratch" opt-in — keeps the seeded bookmarks by default.
                startEmpty: false,
            };
        }

        renderSetupCard() {
            this.draft = this.buildDraft();
            this.setupStep = 0;
            this.setupStepCount = 4;

            const el = document.createElement('div');
            el.className = 'quickstart-card quickstart-setup';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'false');
            el.setAttribute('aria-label', this.t('setupTitle', 'Quick setup'));
            document.body.appendChild(el);
            this.setupEl = el;
            this.renderSetupStep();
            requestAnimationFrame(() => el.classList.add('show'));
        }

        setupStepBody(step) {
            const d = this.draft;
            if (step === 0) {
                return `
                    <label class="quickstart-field">
                        <span>${this.escape(this.t('setupLanguage', 'Language'))}</span>
                        <select class="quickstart-select" data-qs-field="language">
                            <option value="en">English</option>
                            <option value="nl">Nederlands</option>
                            <option value="de">Deutsch</option>
                            <option value="fr">Français</option>
                        </select>
                    </label>
                    <fieldset class="quickstart-fieldset" data-qs-field="autoDarkMode">
                        <legend>${this.escape(this.t('setupAutoDark', 'Auto dark mode (follow system)'))}</legend>
                        <label class="quickstart-radio"><input type="radio" name="qs-autodark" value="true"> <span>${this.escape(this.t('setupOn', 'On'))}</span></label>
                        <label class="quickstart-radio"><input type="radio" name="qs-autodark" value="false"> <span>${this.escape(this.t('setupOff', 'Off'))}</span></label>
                    </fieldset>`;
            }
            if (step === 1) {
                const colOpts = [1, 2, 3, 4, 5, 6]
                    .map((n) => `<option value="${n}">${n}</option>`).join('');
                return `
                    <fieldset class="quickstart-fieldset" data-qs-field="packedColumns">
                        <legend>${this.escape(this.t('setupTightColumns', 'Tight columns'))}</legend>
                        <p class="quickstart-field-hint">${this.escape(this.t('setupTightColumnsHint', 'Fills vertical space better with many categories.'))}</p>
                        <label class="quickstart-radio"><input type="radio" name="qs-packed" value="true"> <span>${this.escape(this.t('setupOn', 'On'))}</span></label>
                        <label class="quickstart-radio"><input type="radio" name="qs-packed" value="false"> <span>${this.escape(this.t('setupOff', 'Off'))}</span></label>
                    </fieldset>
                    <label class="quickstart-field">
                        <span>${this.escape(this.t('setupColumns', 'Number of columns'))}</span>
                        <select class="quickstart-select" data-qs-field="columnsPerRow">${colOpts}</select>
                    </label>`;
            }
            if (step === 2) {
                // step 2 — links + weather
                return `
                    <fieldset class="quickstart-fieldset" data-qs-field="openInNewTab">
                        <legend>${this.escape(this.t('setupLinks', 'Open links in'))}</legend>
                        <label class="quickstart-radio"><input type="radio" name="qs-open" value="true"> <span>${this.escape(this.t('setupLinksNewTab', 'New tab'))}</span></label>
                        <label class="quickstart-radio"><input type="radio" name="qs-open" value="false"> <span>${this.escape(this.t('setupLinksSameTab', 'Current tab'))}</span></label>
                    </fieldset>
                    <fieldset class="quickstart-fieldset" data-qs-field="showWeatherWithDate">
                        <legend>${this.escape(this.t('setupWeather', 'Show weather next to the date'))}</legend>
                        <label class="quickstart-radio"><input type="radio" name="qs-weather" value="false"> <span>${this.escape(this.t('setupNo', 'No'))}</span></label>
                        <label class="quickstart-radio"><input type="radio" name="qs-weather" value="true"> <span>${this.escape(this.t('setupYes', 'Yes'))}</span></label>
                    </fieldset>
                    <label class="quickstart-field" data-qs-weather-location>
                        <span>${this.escape(this.t('setupLocation', 'Location'))}</span>
                        <input class="quickstart-input" type="text" data-qs-field="weatherLocation"
                               placeholder="${this.escape(this.t('setupLocationPlaceholder', 'City name (e.g. Amsterdam)'))}">
                    </label>`;
            }
            // step 3 — starting point: keep bookmarks or start empty.
            // On a first run the only bookmarks present are the seed examples, so we
            // say "example". If onboarding already completed (a rare wizard re-entry)
            // and bookmarks exist, they may be the user's own — drop "example" then so
            // we never promise to only clear samples.
            const hasOwnBookmarks = this.dash?.settings?.onboardingCompleted === true
                && this.bookmarkCount(this.dash) > 0;
            const keepLabel = hasOwnBookmarks
                ? this.t('setupStartKeepOwn', 'Keep my bookmarks')
                : this.t('setupStartKeep', 'Keep the example bookmarks');
            const emptyHint = hasOwnBookmarks
                ? this.t('setupStartEmptyHintOwn', 'Removes every bookmark on every page. Pages, categories, and all settings stay. This cannot be undone.')
                : this.t('setupStartEmptyHint', 'Removes every example bookmark on every page. Pages, categories, and all settings stay. Nothing is added back.');
            return `
                <fieldset class="quickstart-fieldset quickstart-startpoint" data-qs-field="startEmpty">
                    <legend>${this.escape(this.t('setupStartPoint', 'How would you like to begin?'))}</legend>
                    <label class="quickstart-radio quickstart-radio-block">
                        <input type="radio" name="qs-startempty" value="false">
                        <span class="quickstart-radio-text">
                            <span class="quickstart-radio-label">${this.escape(keepLabel)}</span>
                            <span class="quickstart-radio-hint">${this.escape(this.t('setupStartKeepHint', 'Explore nextDash with a ready-made dashboard. You can edit or remove anything later.'))}</span>
                        </span>
                    </label>
                    <label class="quickstart-radio quickstart-radio-block">
                        <input type="radio" name="qs-startempty" value="true">
                        <span class="quickstart-radio-text">
                            <span class="quickstart-radio-label">${this.escape(this.t('setupStartEmpty', 'Start from scratch — no bookmarks'))}</span>
                            <span class="quickstart-radio-hint">${this.escape(emptyHint)}</span>
                        </span>
                    </label>
                </fieldset>
                <p class="quickstart-field-hint quickstart-analytics-note">${this.escape(this.t('setupAnalyticsNote', 'Privacy-friendly usage analytics are off — nothing is sent unless you turn them on. If you do, no bookmark names, URLs, or searches are ever sent. You can turn them on in Config → General.'))}</p>`;
        }

        renderSetupStep() {
            const el = this.setupEl;
            if (!el) return;
            const step = this.setupStep;
            const last = step >= this.setupStepCount - 1;
            const stepTitles = [
                this.t('setupStep1Title', 'Language & theme'),
                this.t('setupStep2Title', 'Layout'),
                this.t('setupStep3Title', 'Links & weather'),
                this.t('setupStep4Title', 'Starting point'),
            ];

            el.innerHTML = `
                <div class="quickstart-stripe"></div>
                <div class="quickstart-inner">
                    <div class="quickstart-head">
                        <p class="quickstart-title">${this.escape(stepTitles[step] || this.t('setupTitle', 'Quick setup'))}</p>
                        <button type="button" class="quickstart-close" data-qs-action="skip-setup" aria-label="${this.escape(this.t('setupSkip', 'Skip'))}">×</button>
                    </div>
                    <p class="quickstart-progress">${this.escape(this.t('setupStepProgress', 'Step {n} of {total}').replace('{n}', String(step + 1)).replace('{total}', String(this.setupStepCount)))}</p>
                    <div class="quickstart-setup-fields">${this.setupStepBody(step)}</div>
                    <div class="quickstart-actions">
                        <button type="button" class="quickstart-btn quickstart-btn-ghost" data-qs-action="back-setup"${step === 0 ? ' disabled' : ''}>${this.escape(this.t('setupBack', 'Back'))}</button>
                        <button type="button" class="quickstart-btn quickstart-btn-primary" data-qs-action="next-setup">${this.escape(last ? this.t('setupFinish', 'Finish') : this.t('setupNext', 'Next'))}</button>
                    </div>
                </div>`;

            this.hydrateSetupStep(step);
            this.bindSetupStep(step);
        }

        hydrateSetupStep(step) {
            const el = this.setupEl;
            const d = this.draft;
            const setSelect = (field, value) => {
                const s = el.querySelector(`[data-qs-field="${field}"]`);
                if (s && s.tagName === 'SELECT') s.value = String(value);
                if (s && s.tagName === 'INPUT' && s.type === 'text') s.value = String(value || '');
            };
            const setRadio = (name, value) => {
                const r = el.querySelector(`input[name="${name}"][value="${value ? 'true' : 'false'}"]`);
                if (r) r.checked = true;
            };
            if (step === 0) {
                setSelect('language', d.language);
                setRadio('qs-autodark', d.autoDarkMode);
            } else if (step === 1) {
                setRadio('qs-packed', d.packedColumns);
                setSelect('columnsPerRow', d.columnsPerRow);
            } else if (step === 2) {
                setRadio('qs-open', d.openInNewTab);
                setRadio('qs-weather', d.showWeatherWithDate);
                setSelect('weatherLocation', d.weatherLocation);
                this.toggleWeatherLocation();
            } else {
                setRadio('qs-startempty', d.startEmpty);
            }
        }

        toggleWeatherLocation() {
            const el = this.setupEl;
            const wrap = el?.querySelector('[data-qs-weather-location]');
            if (wrap) wrap.hidden = this.draft.showWeatherWithDate !== true;
        }

        bindSetupStep(step) {
            const el = this.setupEl;
            const d = this.draft;
            el.querySelector('[data-qs-action="skip-setup"]').addEventListener('click', () => {
                this.captureSetupStep();
                this.finishSetup();
            });
            el.querySelector('[data-qs-action="back-setup"]').addEventListener('click', () => {
                if (this.setupStep === 0) return;
                this.captureSetupStep();
                this.setupStep -= 1;
                this.renderSetupStep();
            });
            el.querySelector('[data-qs-action="next-setup"]').addEventListener('click', () => {
                this.captureSetupStep();
                if (this.setupStep >= this.setupStepCount - 1) {
                    this.finishSetup();
                } else {
                    this.setupStep += 1;
                    this.renderSetupStep();
                }
            });
            if (step === 2) {
                el.querySelectorAll('input[name="qs-weather"]').forEach((r) => {
                    r.addEventListener('change', () => {
                        d.showWeatherWithDate = r.value === 'true';
                        this.toggleWeatherLocation();
                    });
                });
            }
        }

        // Read the DOM for the current step into the draft (survives back/next).
        captureSetupStep() {
            const el = this.setupEl;
            const d = this.draft;
            if (!el) return;
            const selVal = (field) => el.querySelector(`[data-qs-field="${field}"]`)?.value;
            const radioVal = (name) => el.querySelector(`input[name="${name}"]:checked`)?.value;
            const step = this.setupStep;
            if (step === 0) {
                d.language = selVal('language') || d.language;
                const ad = radioVal('qs-autodark'); if (ad != null) d.autoDarkMode = ad === 'true';
            } else if (step === 1) {
                const pc = radioVal('qs-packed'); if (pc != null) d.packedColumns = pc === 'true';
                const cols = parseInt(selVal('columnsPerRow'), 10);
                if (Number.isFinite(cols)) d.columnsPerRow = cols;
            } else if (step === 2) {
                const op = radioVal('qs-open'); if (op != null) d.openInNewTab = op === 'true';
                const w = radioVal('qs-weather'); if (w != null) d.showWeatherWithDate = w === 'true';
                const loc = selVal('weatherLocation'); if (loc != null) d.weatherLocation = loc;
            } else {
                const se = radioVal('qs-startempty'); if (se != null) d.startEmpty = se === 'true';
            }
        }

        async finishSetup() {
            const d = this.dash;
            const draft = this.draft || {};
            if (d) {
                Object.assign(d.settings, {
                    language: draft.language,
                    autoDarkMode: draft.autoDarkMode,
                    packedColumns: draft.packedColumns,
                    columnsPerRow: draft.columnsPerRow,
                    openInNewTab: draft.openInNewTab,
                    showWeatherWithDate: draft.showWeatherWithDate,
                    weatherSource: draft.weatherSource || 'manual',
                    weatherLocation: draft.weatherLocation || '',
                });

                try {
                    if (this.language && typeof this.language.loadTranslations === 'function'
                        && draft.language && draft.language !== this.language.currentLanguage) {
                        await this.language.loadTranslations(draft.language);
                    }
                } catch { /* non-blocking */ }

                // "Start from scratch": wipe the seeded bookmarks before rendering so
                // the dashboard lands on the empty state. Reuses the delete-all endpoint.
                // With no bookmarks left, dashboard status checks have nothing to
                // monitor — turn the setting off so it isn't left dangling.
                if (draft.startEmpty === true) {
                    d.settings.showStatus = false;
                    await this.clearAllBookmarksForFreshStart();
                }

                try {
                    d.setupDOM?.();
                    d.initializeAutoDarkMode?.();
                    d.applyVisualSettings?.();
                    d.renderPageNavigation?.();
                    d.renderDashboard?.();
                    d.updateSearchComponent?.();
                    d.renderDateWeatherLine?.();
                } catch { /* best effort */ }

                this.state().setupDone = true;   // marked in the same single save below
                // Runs after the optional fresh-start wipe, so the baseline is
                // whatever the user actually starts with — 0 when they chose to
                // begin empty, the seed count when they kept the examples.
                this.captureBaseline();
                Promise.resolve(d.saveSettings?.()).catch(() => {});
            }
            this.teardownSetup();
            this.renderChecklist();

            // Keeping the example bookmarks? Pull fresh favicons for all of them
            // now that the card is out of the way. The startup prefetch only fills
            // in missing icons; this re-fetches every one, so the first dashboard a
            // new user sees has real site icons rather than whatever shipped.
            //
            // Skipping the card lands here too — skip-setup calls finishSetup() and
            // startEmpty stays at its default false, so the examples are kept and
            // their icons are fetched just the same. Only an explicit "start from
            // scratch" skips this, because there is nothing left to fetch.
            //
            // Deliberately not awaited by the caller: setup is already complete.
            if (draft.startEmpty !== true) {
                // teardownSetup() removes the card on a 260ms fade and it sits far
                // above the prefetch overlay, so wait it out before showing progress.
                setTimeout(() => void this.fetchAllFaviconsAfterSetup(), 400);
            }
        }

        /**
         * Re-download every bookmark icon, the same run as `:favicons fetch`.
         * Best-effort: a failure here must never affect a finished setup, so it
         * only warns and leaves whatever icons are already there.
         */
        async fetchAllFaviconsAfterSetup() {
            const d = this.dash;
            if (typeof window.ConfigFaviconPrefetch !== 'function') {
                return;
            }
            try {
                const t = (key) => this.language?.t?.(key) ?? key;
                const prefetch = new window.ConfigFaviconPrefetch(t);
                await prefetch.run(null, { refreshAll: true });
                if (typeof d?.loadData === 'function') {
                    await d.loadData();
                    d.renderDashboard?.();
                }
            } catch (error) {
                console.warn('Favicon fetch after setup failed; keeping existing icons.', error);
            }
        }

        // Wipe every seeded bookmark for a fresh start, then clear the in-memory
        // state and page cache so the caller's render lands on the empty state.
        // Reuses POST /api/bookmarks/delete-all — the same path as the config button.
        async clearAllBookmarksForFreshStart() {
            const d = this.dash;
            try {
                const headers = typeof nextDashWriteHeaders === 'function'
                    ? nextDashWriteHeaders({ 'Content-Type': 'application/json' })
                    : { 'Content-Type': 'application/json' };
                const res = await fetch('/api/bookmarks/delete-all', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ confirm: true }),
                });
                if (!res.ok) throw new Error(`delete-all failed: ${res.status}`);
            } catch (error) {
                // Non-blocking: keep the seeded bookmarks rather than failing setup.
                console.warn('Fresh-start bookmark wipe failed; keeping example bookmarks.', error);
                return;
            }
            // Reflect the wipe locally so the render shows the empty state immediately.
            d.bookmarks = [];
            d.allBookmarks = [];
            try { d._pageDataCache?.clear?.(); } catch { /* ignore */ }
        }

        teardownSetup() {
            const el = this.setupEl;
            if (!el) return;
            el.classList.remove('show');
            setTimeout(() => { if (el.isConnected) el.remove(); }, 260);
            this.setupEl = null;
        }

        // ---- Checklist ---------------------------------------------------------

        buildItems() {
            return [
                {
                    id: 'bookmark',
                    label: this.t('itemBookmark', 'Add your first bookmark'),
                    hint: this.t('itemBookmarkHint', 'Press + or paste a URL anywhere'),
                    done: (d) => this.bookmarkCount(d) > Math.max(this.baseline().bookmarks, 0),
                },
                {
                    id: 'config',
                    label: this.t('itemConfig', 'Open Config → General'),
                    hint: this.t('itemConfigHint', 'Tune language, theme and layout'),
                    done: () => this.state().visitedConfig === true,
                },
                {
                    id: 'cheatsheet',
                    label: this.t('itemCheatsheet', 'See the keyboard shortcuts'),
                    hint: this.t('itemCheatsheetHint', 'Press ! or F1'),
                    done: () => this.state().seenCheatsheet === true,
                    // The toolbar's cheat-sheet button is opt-in (showCheatSheetButton),
                    // so this row is the only guaranteed way in on a fresh install.
                    action: () => this.dash.showKeyboardCheatSheet?.(),
                },
            ];
        }

        // A full navigation to /config would race the settings POST, so persist the
        // flag with a keepalive request that survives the page unload. Unlike
        // sendBeacon, keepalive fetch can still send the write-token header.
        markConfigVisitOnNavigation() {
            const links = document.querySelectorAll('.config-link a, a[href="/config"], a[href^="/config#"]');
            links.forEach((link) => {
                link.addEventListener('click', () => {
                    if (this.state().visitedConfig === true) return;
                    this.state().visitedConfig = true;
                    this.saveKeepAlive();
                }, { once: true });
            });
        }

        // Persist settings via a request that survives an imminent navigation,
        // while still carrying auth headers (dashFetch/nextDashFetch add the token).
        saveKeepAlive() {
            const d = this.dash;
            try {
                const payload = typeof window.sanitizeSettingsForPersist === 'function'
                    ? window.sanitizeSettingsForPersist(d.settings)
                    : d.settings;
                const fetchFn = typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
                fetchFn('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive: true,
                }).catch(() => {});
                return;
            } catch { /* fall through to normal save */ }
            this.persistState();
        }

        bookmarkCount(d) {
            const all = Array.isArray(d?.allBookmarks) ? d.allBookmarks.length : 0;
            const page = Array.isArray(d?.bookmarks) ? d.bookmarks.length : 0;
            return Math.max(all, page);
        }

        /** Still recorded in the baseline so the data stays consistent, even though
         *  the checklist no longer has a "tag a bookmark" step. */
        taggedCount(d) {
            const count = (list) => (Array.isArray(list)
                ? list.filter((b) => Array.isArray(b?.tags) && b.tags.length > 0).length
                : 0);
            return Math.max(count(d?.allBookmarks), count(d?.bookmarks));
        }

        /**
         * Bookmark counts as they were when setup finished.
         *
         * A fresh install ships example bookmarks that already carry tags, so
         * comparing against zero ticked "add a bookmark" and "tag a bookmark"
         * before the user had done anything. Captured once; -1 until then, which
         * older installs fall back to (they keep the old zero-based behaviour
         * rather than having items un-tick under them).
         */
        baseline() {
            const qs = this.state();
            const bookmarks = Number.isFinite(qs.baselineBookmarks) ? qs.baselineBookmarks : -1;
            const tagged = Number.isFinite(qs.baselineTagged) ? qs.baselineTagged : -1;
            return { bookmarks, tagged };
        }

        /**
         * Capture once, but only when the bookmarks have actually loaded.
         *
         * The checklist can render before the first page load resolves, and
         * recording 0 then would be worse than not recording at all: every seeded
         * bookmark would count as the user's own. So skip while nothing is loaded
         * yet and let a later call (poll/refresh) capture the real numbers.
         */
        captureBaseline() {
            const qs = this.state();
            if (Number.isFinite(qs.baselineBookmarks) && qs.baselineBookmarks >= 0) return;
            const d = this.dash;
            const loaded = Array.isArray(d?.bookmarks) || Array.isArray(d?.allBookmarks);
            if (!loaded) return;
            qs.baselineBookmarks = this.bookmarkCount(d);
            qs.baselineTagged = this.taggedCount(d);
        }

        renderChecklist() {
            if (this.el) return;
            const el = document.createElement('div');
            el.className = 'quickstart-card quickstart-checklist';
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', this.t('title', 'Quick start'));
            el.innerHTML = `
                <div class="quickstart-stripe"></div>
                <div class="quickstart-inner">
                    <div class="quickstart-head">
                        <p class="quickstart-title">${this.escape(this.t('title', 'Quick start'))}</p>
                        <button type="button" class="quickstart-close" data-qs-action="dismiss" aria-label="${this.escape(this.t('dismiss', 'Dismiss'))}">×</button>
                    </div>
                    <p class="quickstart-progress" data-qs-progress></p>
                    <ul class="quickstart-list" data-qs-list></ul>
                </div>`;

            el.querySelector('[data-qs-action="dismiss"]').addEventListener('click', () => this.dismiss());
            document.body.appendChild(el);
            this.el = el;
            requestAnimationFrame(() => el.classList.add('show'));

            this.markConfigVisitOnNavigation();
            this.refresh();
            this.startPolling();
        }

        refresh() {
            if (!this.el) return;
            const d = this.dash;
            // Capture here rather than at render time: this runs once the page's
            // bookmarks have loaded, so the baseline reflects what is really there.
            this.captureBaseline();
            const items = this.buildItems();
            const list = this.el.querySelector('[data-qs-list]');
            const progressEl = this.el.querySelector('[data-qs-progress]');
            if (!list) return;

            let doneCount = 0;
            list.innerHTML = items.map((item) => {
                let done = false;
                try { done = item.done(d) === true; } catch { done = false; }
                if (done) { doneCount += 1; this.completed.add(item.id); }
                const text = `
                    <span class="quickstart-check">${done ? CHECK_ICON : ''}</span>
                    <span class="quickstart-item-text">
                        <span class="quickstart-item-label">${this.escape(item.label)}</span>
                        ${item.hint ? `<span class="quickstart-item-hint">${this.escape(item.hint)}</span>` : ''}
                    </span>`;
                // Actionable rows stay reachable once done: re-opening is harmless and
                // the row is the discovery path for anyone without the toolbar button.
                const body = item.action
                    ? `<button type="button" class="quickstart-item-action" data-qs-item="${this.escape(item.id)}">${text}</button>`
                    : text;
                return `<li class="quickstart-item${done ? ' is-done' : ''}${item.action ? ' is-actionable' : ''}">${body}</li>`;
            }).join('');

            list.querySelectorAll('[data-qs-item]').forEach((btn) => {
                const item = items.find((i) => i.id === btn.getAttribute('data-qs-item'));
                if (!item?.action) return;
                btn.addEventListener('click', () => {
                    try { item.action(); } catch { /* ignore */ }
                });
            });

            if (progressEl) {
                progressEl.textContent = this.t('progress', '{done} of {total} done')
                    .replace('{done}', String(doneCount))
                    .replace('{total}', String(items.length));
            }

            if (doneCount >= items.length) {
                this.complete();
            }
        }

        startPolling() {
            this.stopPolling();
            this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
            this.focusHandler = () => this.refresh();
            window.addEventListener('focus', this.focusHandler);
            document.addEventListener('visibilitychange', this.focusHandler);
        }

        stopPolling() {
            if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
            if (this.focusHandler) {
                window.removeEventListener('focus', this.focusHandler);
                document.removeEventListener('visibilitychange', this.focusHandler);
                this.focusHandler = null;
            }
        }

        // Finished all items: briefly show a done state, then persist + close.
        complete() {
            this.stopPolling();
            if (this.el) this.el.classList.add('is-complete');
            this.persistCompleted();
            setTimeout(() => this.teardownChecklist(), 1800);
        }

        // User dismissed early: still mark onboarding complete so it never returns.
        dismiss() {
            this.stopPolling();
            this.persistCompleted();
            this.teardownChecklist();
        }

        persistCompleted() {
            const d = this.dash;
            this.state().dismissed = true;
            if (d && d.settings?.onboardingCompleted !== true) {
                d.settings.onboardingCompleted = true;
            }
            this.persistState();
        }

        teardownChecklist() {
            const el = this.el;
            if (!el) return;
            el.classList.remove('show');
            setTimeout(() => { if (el.isConnected) el.remove(); }, 260);
            this.el = null;
        }

        escape(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }
    }

    window.QuickStart = QuickStart;
})();
