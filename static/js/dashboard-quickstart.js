/**
 * Quick-start: a lightweight, non-blocking onboarding replacement.
 *
 * Replaces the old step-by-step Onboarding wizard (onboarding.js), and the
 * compact setup card that stood between it and this: a first run that opens on
 * a window of questions asks for answers before the reader has seen what they
 * are about. What is left is one small dismissible checklist of first tasks,
 * auto-checked from dashboard state (no per-action event hooks — state is
 * re-derived on focus/interval); the settings it used to ask for all live in
 * config, where they can be found again.
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
                d.settings.quickStart = { dismissed: false, visitedConfig: false, seenCheatsheet: false };
            }
            return d.settings.quickStart;
        }

        persistState() {
            Promise.resolve(this.dash?.saveSettings?.()).catch(() => {});
        }

        // Only first-run installs (onboardingCompleted !== true) see quick-start.
        shouldStart() {
            if (this.dash?.settings?.onboardingCompleted === true) return false;
            if (this.state().dismissed === true) {
                // Two flags record the same fact, and an install can end up
                // holding one without the other: dismissed here, but
                // onboardingCompleted still false. That install falls between
                // the two -- quick-start does not start (dismissed), and every
                // unprompted card is refused as well, because
                // canShowUnpromptedUi requires onboardingCompleted. The
                // What's new modal after an upgrade is the visible loss: the
                // release check says show it and nothing ever asks.
                //
                // Dismissing the card is finishing the onboarding, so the
                // stricter flag is brought into line the moment the drift is
                // noticed, rather than leaving the reader to find a setting
                // that does not exist in the interface.
                this.reconcileOnboardingCompleted();
                return false;
            }
            return true;
        }

        /**
         * Bring onboardingCompleted into line with a dismissed quick-start.
         *
         * Writes only when they actually disagree, so an ordinary load costs
         * nothing and the settings file is not rewritten on every visit.
         */
        reconcileOnboardingCompleted() {
            const d = this.dash;
            if (!d?.settings || d.settings.onboardingCompleted === true) return;
            d.settings.onboardingCompleted = true;
            this.persistState();
        }

        start() {
            if (!this.shouldStart()) return;
            this.renderChecklist();
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
         * Bookmark counts as they were when the checklist first appeared.
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

        // Delegates to the shared helper so this cannot drift from it again: the
        // local copy left `'` unescaped, which is only harmless for as long as
        // every caller happens to interpolate into a double-quoted attribute.
        // The fallback covers the onboarding card rendering before the dashboard
        // has finished wiring itself up.
        escape(value) {
            const text = String(value == null ? '' : value);
            return this.dash?.escapeHtml ? this.dash.escapeHtml(text) : text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    }

    window.QuickStart = QuickStart;
})();
