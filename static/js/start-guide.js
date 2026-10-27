/**
 * The start guide: what a fresh install opens on.
 *
 * The reader sees the dashboard with its example links first. After a moment a
 * bar slides in at the bottom of the screen, "Quick start", and opens a modal
 * in the middle: what to do with the example links, the language, the weather
 * and the first steps. The modal opens by itself once, three seconds after the
 * bar is up, so a new reader meets it first; after that only the reader opens it. The bar stays on the
 * dashboard of page 1 until every step is done or the reader closes it for
 * good, and it holds the corner for as long as it is there, so no other card
 * competes with it (NoticeCard.cornerIsFree).
 *
 * It replaces two things that used to come one after the other: the
 * first-start card ("What do you want?") and the quick-start checklist in the
 * corner. The orchestration -- when to start, what counts as finished -- is
 * still QuickStart's (dashboard-quickstart.js); this is the part you see.
 *
 * Progress lives in settings.quickStart (server-side, per install): the answer
 * to the example links, the steps done, and when it was finished.
 */
(function (global) {
    'use strict';

    const MAIN_PAGE_ID = 1;
    // The dashboard is seen on its own first: the bar comes a moment later.
    const BAR_DELAY_MS = 1100;
    const PLACE_MS = 500;
    // Three seconds after the bar is up, the first time in this browser: the modal
    // opens by itself. A test turns it off with window.__e2eStartGuideAutoOpenMs = -1.
    const AUTO_OPEN_MS = 3000;
    const DOCS_URL = 'https://nextdash.cc/docs/';
    // Set once the modal has been opened in this browser: the bar pulses on
    // every load until then, because it is for finding the bar, and stops
    // when it has been found. (A count of loads stopped it after a few
    // reloads, before anyone had looked.)
    const FOUND_KEY = 'nextdash:start-guide-found';
    const VISIBLE_STEPS = 3;
    const STARTER_IDS = ['homelab', 'media-server', 'developer'];
    const LANGUAGES = [
        ['en', 'English'], ['nl', 'Nederlands'], ['de', 'Deutsch'],
        ['fr', 'Français'], ['zh', '中文'], ['es', 'Español'],
    ];

    function dash() {
        return global.dashboardInstance || null;
    }

    /** A string from the active language, or the English fallback. */
    function tr(fullKey, fallback, params) {
        const lang = dash()?.language;
        let text = fallback;
        if (lang?.t) {
            const value = lang.t(fullKey);
            if (value && value !== fullKey) text = value;
        }
        return params
            ? Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), String(text))
            : String(text);
    }

    const tq = (key, fallback, params) => tr(`quickstart.${key}`, fallback, params);
    const tf = (key, fallback, params) => tr(`firstStart.${key}`, fallback, params);

    const esc = (value) => global.NextDashHtml.escapeHtml(String(value ?? ''));

    /**
     * The steps, in the order they are offered. `run` is what a click does; a
     * click also counts the step as done, because nothing else can tell that a
     * reader has looked at a settings page.
     */
    function buildSteps(guide) {
        const go = (hash) => () => guide.goTo(hash);
        const steps = [
            {
                id: 'tour',
                label: tq('stepTour', 'Take the 1-minute tour'),
                hint: tq('stepTourHint', 'A map of the dashboard'),
                run: () => guide.runTour(),
            },
            {
                id: 'import',
                label: tq('stepImport', 'Import your bookmarks'),
                hint: tq('stepImportHint', 'From your browser'),
                run: go('#config/data-backups'),
            },
            {
                id: 'extension',
                label: tq('stepExtension', 'Get the browser extension'),
                hint: tq('stepExtensionHint', 'Save a page without leaving it'),
                run: () => { global.open(DOCS_URL, '_blank', 'noopener'); },
            },
            {
                id: 'bookmarks',
                label: tq('stepBookmarks', 'Open the Bookmarks view'),
                hint: tq('stepBookmarksHint', 'Every bookmark, searchable'),
                run: go('#bookmarks'),
            },
            {
                id: 'inbox',
                label: tq('stepInbox', 'Open the Inbox view'),
                hint: tq('stepInboxHint', 'Where saved links wait to be filed'),
                run: go('#inbox'),
            },
            {
                id: 'widget',
                label: tq('stepWidget', 'Add a widget'),
                hint: tq('stepWidgetHint', 'Media, Home Assistant, notes'),
                run: go('#config/widgets'),
            },
            {
                id: 'checks',
                label: tq('stepChecks', 'Turn on status checks'),
                hint: tq('stepChecksHint', 'For a few of your links'),
                run: go('#config/monitoring/checks'),
            },
            {
                id: 'notifications',
                label: tq('stepNotifications', 'Set up notifications'),
                hint: tq('stepNotificationsHint', 'Hear when something is down'),
                run: go('#config/monitoring/notifications'),
            },
            {
                id: 'overview',
                label: tq('stepOverview', 'Open the Config settings'),
                hint: tq('stepOverviewHint', 'An overview of your install'),
                run: go('#config/overview'),
            },
            {
                id: 'secondPage',
                label: tq('stepSecondPage', 'Add a second page'),
                hint: tq('stepSecondPageHint', 'Keep work and home apart'),
                run: go('#config/pages-tags'),
            },
        ];
        // Only on an Unraid server: the step has nothing to open anywhere else.
        if (guide.platform === 'unraid') {
            steps.push({
                id: 'unraid',
                label: tq('stepUnraid', 'Connect your Unraid server'),
                hint: tq('stepUnraidHint', 'See your array and shares'),
                run: go('#config/unraid'),
            });
        }
        return steps;
    }

    class StartGuide {
        constructor(dashboard, { onDone } = {}) {
            this.dash = dashboard;
            this.onDone = typeof onDone === 'function' ? onDone : () => {};
            this.bar = null;
            this.overlay = null;
            this.revealed = false;
            this.showAll = false;
            this.emptyAsk = false;
            this.busy = false;
            this.replacesMain = false;
            this.bundled = null;
            this.platform = '';
            this.starterId = '';
            this.starterServer = '';
            this.starterError = '';
            this.langTouched = false;
            this.langHintTracked = false;
            this.lastAllSet = false;
            this.langToken = 0;
            this.timers = [];
            this.scrollLockToken = null;
            this.keyHandler = (event) => this.onKey(event);
        }

        // ---- State -------------------------------------------------------------

        state() {
            const d = this.dash;
            if (!d.settings) d.settings = {};
            if (!d.settings.quickStart || typeof d.settings.quickStart !== 'object') d.settings.quickStart = {};
            return d.settings.quickStart;
        }

        steps() {
            return buildSteps(this);
        }

        doneSet() {
            const done = this.state().stepsDone;
            return new Set(Array.isArray(done) ? done : []);
        }

        save() {
            Promise.resolve(this.dash.saveSettings?.()).catch(() => {});
        }

        /** Count these steps as done, and say so on the bar. */
        markSteps(ids) {
            const set = this.doneSet();
            (Array.isArray(ids) ? ids : [ids]).forEach((id) => set.add(id));
            this.state().stepsDone = [...set];
            this.save();
            this.refresh();
        }

        // ---- Showing -----------------------------------------------------------

        async show() {
            try {
                const res = await fetch('/api/page-templates/bundled');
                if (res.ok) {
                    const data = await res.json();
                    // Only main as it started can be emptied; anything somebody
                    // changed is theirs, and there is nothing to ask about it.
                    this.replacesMain = data.replacesMain === true;
                    this.bundled = data;
                    this.platform = data.platform === 'unraid' ? 'unraid' : '';
                }
            } catch { /* the steps still make sense without the choice */ }
            this.buildBar();
            this.timers.push(setTimeout(() => this.reveal(), BAR_DELAY_MS));
            this.timers.push(setInterval(() => this.place(), PLACE_MS));
            this.hashHandler = () => this.place();
            global.addEventListener('hashchange', this.hashHandler);
        }

        /** The dashboard of page 1, while the onboarding is not finished. */
        atHome() {
            const d = this.dash;
            if (d.settings?.onboardingCompleted === true) return false;
            return Number(d.currentPageId) === MAIN_PAGE_ID && (!d.activeView || d.activeView === 'bookmarks');
        }

        /** The bar waits for any other modal (what's new, a form) to be done. */
        reveal() {
            if (!this.bar) return;
            if ((this.dash.isModalOpen?.() || global.LookMigrationNotice?.blocking?.()) && !this.overlay) {
                this.timers.push(setTimeout(() => this.reveal(), 600));
                return;
            }
            this.revealed = true;
            this.place();
            this.pulse();
            this.scheduleAutoOpen();
        }

        hasBeenFound() {
            try { return localStorage.getItem(FOUND_KEY) === '1'; } catch { return false; }
        }

        /** The first time, the modal grows out of the bar on its own. */
        scheduleAutoOpen(attempt = 0) {
            if (this.hasBeenFound()) return;
            const wanted = global.__e2eStartGuideAutoOpenMs;
            const wait = Number.isFinite(wanted) ? wanted : AUTO_OPEN_MS;
            if (wait < 0) return;
            this.timers.push(setTimeout(() => {
                if (this.overlay || !this.revealed || this.hasBeenFound() || !this.atHome()) return;
                // Another modal (what's new, a form) has the page: try again shortly.
                if (this.dash.isModalOpen?.()) {
                    if (attempt < 20) this.scheduleAutoOpen(attempt + 1);
                    return;
                }
                this.open();
            }, attempt === 0 ? wait : 1000));
        }

        place() {
            const bar = this.bar;
            if (!bar) return;
            if (this.dash.settings?.onboardingCompleted === true) {
                // Finished somewhere else (another tab, a test, a reset): let
                // QuickStart forget this instance so a restart can make a new one.
                this.teardown();
                this.onDone();
                return;
            }
            const visible = this.revealed && this.atHome();
            bar.classList.toggle('show', visible);
            bar.toggleAttribute('inert', !visible);
            if (!visible && this.overlay) this.close({ land: false });
        }

        /** Soft pulses so the eye finds the bar, until it has been opened once. */
        pulse() {
            let found = false;
            try { found = localStorage.getItem(FOUND_KEY) === '1'; } catch { /* none */ }
            if (found) return;
            this.bar?.classList.add('is-pulsing');
        }

        /** Remembered per browser: the bar has been found, so it stops pulsing. */
        markFound() {
            try { localStorage.setItem(FOUND_KEY, '1'); } catch { /* none */ }
            this.bar?.classList.remove('is-pulsing');
        }

        // ---- The bar -----------------------------------------------------------

        buildBar() {
            if (this.bar) return;
            const bar = document.createElement('div');
            // quickstart-card: blocks every card that is not essential (an Undo for
            // something that already happened is, and shows above the bar).
            bar.className = 'quickstart-card start-guide-bar';
            bar.setAttribute('data-start-guide-bar', '');
            bar.addEventListener('click', (event) => this.onBarClick(event));
            bar.addEventListener('animationend', (event) => {
                if (event.animationName === 'sg-land') bar.classList.remove('is-landed');
            });
            document.body.appendChild(bar);
            this.bar = bar;
            this.refresh();
        }

        progress() {
            const steps = this.steps();
            const done = this.doneSet();
            const count = steps.filter((s) => done.has(s.id)).length;
            return { total: steps.length, count };
        }

        renderBar() {
            const { total, count } = this.progress();
            const allSet = count >= total;
            this.bar.classList.toggle('is-all-set', allSet);
            const percent = Math.round((count / total) * 100);
            const progress = tq('progress', '{done} of {total} done', { done: count, total });
            if (allSet) {
                this.bar.innerHTML = `
                    <button type="button" class="sg-bar-main" data-sg-all-set>
                        <span class="sg-bar-dot" aria-hidden="true"></span>
                        <span class="sg-bar-text"><b>${esc(tq('guideAllSet', 'All set'))}</b><span>${esc(tq('guideAllSetHint', 'Close the quick start'))}</span></span>
                    </button>`;
                return;
            }
            this.bar.innerHTML = `
                <button type="button" class="sg-bar-main" data-start-guide-open aria-haspopup="dialog" aria-expanded="${this.overlay ? 'true' : 'false'}">
                    <span class="sg-bar-dot" aria-hidden="true"></span>
                    <span class="sg-bar-text"><b>${esc(tq('title', 'Quick start'))}</b><span>${esc(progress)}</span></span>
                    <span class="sg-bar-progress" aria-hidden="true"><i style="width:${percent}%"></i></span>
                </button>
                <button type="button" class="sg-bar-close" data-start-guide-close aria-label="${esc(tq('guideCloseForGood', 'Close for good'))}">×</button>
                <div class="sg-bar-confirm" data-sg-confirm hidden>
                    <p>${esc(tq('guideCloseAsk', 'Close the quick start for good? It will not come back.'))}</p>
                    <div>
                        <button type="button" class="sg-btn" data-sg-cancel-close>${esc(tq('guideKeep', 'Keep it'))}</button>
                        <button type="button" class="sg-btn sg-btn-primary" data-sg-confirm-close>${esc(tq('guideCloseForGood', 'Close for good'))}</button>
                    </div>
                </div>`;
        }

        onBarClick(event) {
            const target = event.target.closest('button');
            if (!target) return;
            if (target.hasAttribute('data-start-guide-open')) { this.open(); return; }
            if (target.hasAttribute('data-start-guide-close')) {
                const ask = this.bar.querySelector('[data-sg-confirm]');
                if (ask) ask.hidden = false;
                return;
            }
            if (target.hasAttribute('data-sg-cancel-close')) {
                const ask = this.bar.querySelector('[data-sg-confirm]');
                if (ask) ask.hidden = true;
                return;
            }
            if (target.hasAttribute('data-sg-confirm-close') || target.hasAttribute('data-sg-all-set')) this.complete();
        }

        // ---- The modal ---------------------------------------------------------

        open() {
            if (this.overlay) return;
            this.markFound();
            const overlay = document.createElement('div');
            overlay.className = 'start-guide-overlay';
            overlay.setAttribute('data-start-guide-overlay', '');
            overlay.innerHTML = `<div class="start-guide-modal" data-start-guide-modal role="dialog" aria-modal="true" aria-labelledby="sg-title" tabindex="-1"></div>`;
            overlay.addEventListener('mousedown', (event) => {
                if (event.target === overlay) this.close();
            });
            document.body.appendChild(overlay);
            this.overlay = overlay;
            this.scrollLockToken = global.ScrollLock?.acquire?.('start-guide') ?? null;
            document.addEventListener('keydown', this.keyHandler, true);
            // The panel's clicks are wired once, here, by delegation: the content
            // is drawn again on Show more and on a language change, and a
            // listener added on each draw would run the same click twice.
            this.wirePanel(overlay.querySelector('[data-start-guide-modal]'));
            this.lastAllSet = this.progress().count >= this.progress().total;
            this.renderModal();
            this.refresh();
            requestAnimationFrame(() => {
                overlay.classList.add('show');
                this.flyFromBar(overlay, 'out');
                overlay.querySelector('[data-sg-keep], [data-sg-step] button, button')?.focus({ preventScroll: true });
            });
        }

        /**
         * The modal grows out of the bar and folds back into it. Both are one
         * transform: the modal moved and scaled onto the bar's own box. Nothing
         * moves when the bar is not on screen (a notice has the corner, the
         * window is too small) or when motion is off. Answers the animation, or
         * null when there is none.
         */
        flyFromBar(overlay, direction) {
            const modal = overlay.querySelector('[data-start-guide-modal]');
            const bar = this.bar;
            if (!modal || !bar || typeof modal.animate !== 'function') return null;
            if (document.body.classList.contains('no-animations')) return null;
            if (global.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
            const from = bar.getBoundingClientRect();
            if (!from.width || getComputedStyle(bar).visibility === 'hidden') return null;
            // Layout size, not the rect: the rect still carries the entrance transform.
            const width = modal.offsetWidth;
            const height = modal.offsetHeight;
            const box = overlay.getBoundingClientRect();
            if (!width || !height) return null;
            const scale = Math.min(1, Math.max(0.08, from.width / width));
            const dx = from.left + from.width / 2 - (box.left + box.width / 2);
            const dy = from.top + from.height / 2 - (box.top + box.height / 2);
            const there = `translate(${dx}px, ${dy}px) scale(${scale})`;
            const out = direction === 'out';
            modal.style.transition = 'none';
            overlay.style.transition = 'none';
            const timing = { duration: out ? 380 : 260, easing: out ? 'cubic-bezier(0.2, 0.85, 0.25, 1)' : 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'both' };
            const fade = overlay.animate([{ opacity: out ? 0 : 1 }, { opacity: out ? 1 : 0 }], timing);
            const move = modal.animate(
                out
                    ? [{ transform: there, opacity: 0.35 }, { transform: 'none', opacity: 1 }]
                    : [{ transform: 'none', opacity: 1 }, { transform: there, opacity: 0.2 }],
                timing
            );
            if (out) {
                // Arrived: the page's own styles say the same, so hand over to them.
                move.addEventListener('finish', () => {
                    move.cancel();
                    fade.cancel();
                    modal.style.transition = '';
                    overlay.style.transition = '';
                });
            }
            return move;
        }

        /** Fold the modal back into the bar; the bar says where it went. */
        close({ land = true } = {}) {
            const overlay = this.overlay;
            if (!overlay) return;
            this.overlay = null;
            this.emptyAsk = false;
            document.removeEventListener('keydown', this.keyHandler, true);
            global.ScrollLock?.release?.(this.scrollLockToken);
            this.scrollLockToken = null;
            // Read the bar before refresh() redraws it; the fold ends on its box.
            const fold = this.flyFromBar(overlay, 'in');
            const finish = () => {
                overlay.classList.remove('show');
                overlay.remove();
                if (land && this.bar) {
                    this.bar.classList.remove('is-landed');
                    // Restarts the one-off glow even when it was just running.
                    void this.bar.offsetWidth;
                    this.bar.classList.add('is-landed');
                    this.bar.querySelector('[data-start-guide-open], [data-sg-all-set]')?.focus({ preventScroll: true });
                }
            };
            this.refresh();
            if (!fold) { finish(); return; }
            // Out of the way of the page while it folds: clicks reach the bar, and
            // what is folding is no longer the dialog, to a reader or to the page.
            overlay.style.pointerEvents = 'none';
            overlay.removeAttribute('data-start-guide-overlay');
            const folding = overlay.firstElementChild;
            folding?.removeAttribute('data-start-guide-modal');
            folding?.setAttribute('aria-hidden', 'true');
            fold.onfinish = finish;
            fold.oncancel = finish;
        }

        onKey(event) {
            if (!this.overlay) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.close();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...this.overlay.querySelectorAll('button, input, select, a[href]')]
                .filter((el) => !el.disabled && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            // Focus that fell out of the dialog (the button it was on was drawn
            // again or hidden) comes back in at the end it was heading for.
            if (!this.overlay.contains(document.activeElement) || document.activeElement === this.overlay.firstElementChild) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
                return;
            }
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }

        renderStep(step, done, hidden) {
            return `
                <li class="sg-step${done ? ' is-done' : ''}" data-sg-step="${esc(step.id)}"${hidden ? ' hidden' : ''}>
                    <button type="button" class="sg-step-button">
                        <span class="sg-check${done ? ' is-done' : ''}" aria-hidden="true"></span>
                        <span class="sg-step-text">${esc(step.label)}</span>
                        <span class="sg-step-hint">${esc(step.hint)}</span>
                    </button>
                </li>`;
        }

        renderModal() {
            const panel = this.overlay?.querySelector('[data-start-guide-modal]');
            if (!panel) return;
            const d = this.dash;
            // What had focus, so it can be given back to the same control (or the
            // nearest thing) once the content is drawn again.
            const active = document.activeElement;
            const focusKey = active && panel.contains(active)
                ? ['data-sg-language', 'data-sg-city', 'data-sg-unit', 'data-sg-keep', 'data-sg-empty', 'data-sg-starter-server', 'data-sg-starter-create', 'data-sg-lang-switch']
                    .map((attr) => (active.hasAttribute?.(attr) ? `[${attr}${attr === 'data-sg-unit' ? `="${active.getAttribute(attr)}"` : ''}]` : ''))
                    .find(Boolean) || ''
                : '';
            const steps = this.steps();
            const done = this.doneSet();
            const open = steps.filter((s) => !done.has(s.id));
            const shown = new Set(this.showAll ? steps.map((s) => s.id) : open.slice(0, VISIBLE_STEPS).map((s) => s.id));
            const hiddenCount = steps.length - shown.size;
            const lang = d.settings?.language || 'en';
            const unit = d.settings?.weatherUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
            const city = d.settings?.weatherLocation || '';
            const answered = ['keep', 'empty'].includes(this.state().templatePicked);
            const hasChoice = this.replacesMain && !answered;
            const starter = this.renderStarter();
            const langHint = this.languageSuggestion();
            if (langHint && !this.langHintTracked) {
                this.langHintTracked = true;
                global.nextdashTrack?.('language-suggest', { action: 'shown', to: langHint[0] });
            }
            const choices = hasChoice ? `
                <div class="sg-choices">
                    <button type="button" class="sg-choice sg-choice-primary" data-sg-keep>
                        <b>${esc(tf('keepExamples', 'Keep these example links'))}</b>
                        <span>${esc(tq('guideKeepHint', 'Look around first'))}</span>
                    </button>
                    <button type="button" class="sg-choice" data-sg-empty>
                        <b>${esc(tf('startEmpty', 'Start with an empty page'))}</b>
                        <span>${esc(tf('startEmptyHint', 'Remove the example links and add your own'))}</span>
                    </button>
                </div>
                <div class="sg-empty-ask" data-sg-empty-ask${this.emptyAsk ? '' : ' hidden'}>
                    <p>${esc(tq('guideEmptyAsk', 'Remove the example links from this page?'))}</p>
                    <div>
                        <button type="button" class="sg-btn" data-sg-empty-cancel>${esc(tq('guideCancel', 'Cancel'))}</button>
                        <button type="button" class="sg-btn sg-btn-primary" data-sg-empty-confirm>${esc(tq('guideRemove', 'Remove them'))}</button>
                    </div>
                </div>
                <p class="sg-error" data-sg-error role="alert" hidden></p>` : '';
            panel.innerHTML = `
                <div class="sg-head">
                    <div>
                        <h2 id="sg-title" data-sg-title>${esc(hasChoice ? tf('titleWant', 'what do you want?') : tq('title', 'Quick start'))}</h2>
                        ${hasChoice ? `<p class="sg-sub">${esc(tf('introWant', 'This page starts with example links. Keep them to look around, or clear them and add your own.'))}</p>` : ''}
                    </div>
                    <label class="sg-lang">
                        <span>${esc(tq('guideLanguage', 'Language'))}</span>
                        <select data-sg-language aria-label="${esc(tq('guideLanguage', 'Language'))}">
                            ${LANGUAGES.map(([code, name]) => `<option value="${code}"${code === lang ? ' selected' : ''}>${esc(name)}</option>`).join('')}
                        </select>
                        ${langHint ? `<span class="sg-lang-hint" data-sg-lang-hint>${esc(tq('guideLanguageDetected', '{language} detected', { language: langHint[1] }))} <button type="button" class="sg-link" data-sg-lang-switch="${esc(langHint[0])}">${esc(tq('guideLanguageSwitch', 'Switch'))}</button></span>` : ''}
                    </label>
                </div>
                ${choices}
                <p class="sg-links">
                    <button type="button" class="sg-link" data-sg-manual>${esc(tf('showManual', 'Show me the manual first'))}</button>
                    <span aria-hidden="true">·</span>
                    <button type="button" class="sg-link" data-sg-studio>${esc(tf('openStudio', 'Open the theme studio'))}</button>
                </p>
                <hr class="sg-rule">
                <p class="sg-label">${esc(tq('guideSetUp', 'Set up'))}</p>
                <div class="sg-weather">
                    <label for="sg-city">${esc(tq('guideWeather', 'Weather'))}</label>
                    <input id="sg-city" type="text" data-sg-city autocomplete="off" value="${esc(city)}" placeholder="${esc(tq('guideCityPlaceholder', 'City, e.g. Amsterdam'))}">
                    <span class="sg-seg" role="group" aria-label="${esc(tq('guideUnit', 'Temperature unit'))}">
                        <button type="button" data-sg-unit="celsius" aria-pressed="${unit === 'celsius'}">°C</button>
                        <button type="button" data-sg-unit="fahrenheit" aria-pressed="${unit === 'fahrenheit'}">°F</button>
                    </span>
                </div>
                ${starter}
                <hr class="sg-rule">
                <p class="sg-label">${esc(tq('guideNextSteps', 'Next steps'))}</p>
                <ul class="sg-steps">${steps.map((s) => this.renderStep(s, done.has(s.id), !shown.has(s.id))).join('')}</ul>
                ${hiddenCount > 0 && !this.showAll ? `<button type="button" class="sg-more" data-sg-more>${esc(tq('guideShowMore', 'Show {n} more', { n: hiddenCount }))} ▾</button>` : ''}
                <p class="sg-back" data-sg-back-hint><kbd>Esc</kbd> ${esc(tq('guideOr', 'or'))} <kbd>1</kbd> ${esc(tq('guideBackHint', 'brings you back to the dashboard from anywhere'))}</p>
                <div class="sg-foot">
                    <span class="sg-foot-progress" data-sg-progress>${esc(tq('progress', '{done} of {total} done', { done: this.progress().count, total: steps.length }))}</span>
                    ${this.progress().count >= steps.length
        ? `<button type="button" class="sg-btn sg-btn-primary" data-sg-all-set>${esc(tq('guideAllSet', 'All set'))}</button>`
        : `<button type="button" class="sg-btn" data-sg-minimise>${esc(tq('guideCloseForNow', 'Close for now'))}</button>`}
                </div>`;
            this.wireFields(panel);
            const back = (focusKey && panel.querySelector(focusKey)) || (focusKey !== null && !panel.contains(document.activeElement) ? panel : null);
            if (back && !panel.contains(document.activeElement)) back.focus({ preventScroll: true });
        }

        /** Clicks, once, by delegation. */
        wirePanel(panel) {
            panel.addEventListener('click', (event) => {
                const target = event.target.closest('button');
                if (!target) return;
                if (target.hasAttribute('data-sg-keep')) { void this.answer('keep'); return; }
                if (target.hasAttribute('data-sg-empty')) {
                    this.emptyAsk = true;
                    panel.querySelector('[data-sg-empty-ask]').hidden = false;
                    panel.querySelector('[data-sg-empty-confirm]')?.focus();
                    return;
                }
                if (target.hasAttribute('data-sg-empty-cancel')) {
                    this.emptyAsk = false;
                    panel.querySelector('[data-sg-empty-ask]').hidden = true;
                    panel.querySelector('[data-sg-empty]')?.focus({ preventScroll: true });
                    return;
                }
                if (target.hasAttribute('data-sg-empty-confirm')) { void this.startEmpty(); return; }
                const pick = target.getAttribute('data-sg-starter');
                if (pick) { this.pickStarter(pick); return; }
                if (target.hasAttribute('data-sg-starter-create')) { void this.createStarter(); return; }
                const switchTo = target.getAttribute('data-sg-lang-switch');
                if (switchTo) { this.acceptLanguage(switchTo); return; }
                if (target.hasAttribute('data-sg-manual')) { global.open(DOCS_URL, '_blank', 'noopener'); return; }
                if (target.hasAttribute('data-sg-studio')) { this.openStudio(); return; }
                if (target.hasAttribute('data-sg-minimise')) { this.close(); return; }
                if (target.hasAttribute('data-sg-all-set')) { this.complete(); return; }
                if (target.hasAttribute('data-sg-more')) {
                    this.showAll = true;
                    this.renderModal();
                    return;
                }
                const unit = target.getAttribute('data-sg-unit');
                if (unit) { this.saveWeather({ unit }); return; }
                const step = target.closest('[data-sg-step]');
                if (step) void this.runStep(step.getAttribute('data-sg-step'));
            });
        }

        /** The inputs, drawn again with the content, so wired again with it. */
        wireFields(panel) {
            const city = panel.querySelector('[data-sg-city]');
            city.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') { event.preventDefault(); this.saveWeather({ city: city.value }); }
            });
            city.addEventListener('change', () => this.saveWeather({ city: city.value }));
            panel.querySelector('[data-sg-language]').addEventListener('change', (event) => {
                this.langTouched = true;
                void this.setLanguage(event.target.value);
            });
            const server = panel.querySelector('[data-sg-starter-server]');
            if (server) {
                server.addEventListener('input', () => { this.starterServer = server.value; });
                server.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void this.createStarter(); }
                });
            }
        }

        // ---- Ready-made pages and the language hint ------------------------------

        starterTemplates() {
            const list = this.bundled?.templates;
            return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string') : [];
        }

        renderStarter() {
            const list = this.starterTemplates();
            if (!list.length) return '';
            const sub = this.replacesMain
                ? tq('guideStarterReplaces', 'Replaces the example links.')
                : tq('guideStarterNew', 'Added as a new page.');
            const cards = list.map((t) => `
                    <button type="button" class="sg-choice${t.id === this.starterId ? ' sg-choice-primary' : ''}" data-sg-starter="${esc(t.id)}" aria-pressed="${t.id === this.starterId}">
                        <b>${esc(t.name)}</b>
                        <span>${(Array.isArray(t.services) ? t.services.slice(0, 3) : []).map((n) => `<i class="sg-chip">${esc(n)}</i>`).join('')}</span>
                    </button>`).join('');
            const open = this.starterId && list.some((t) => t.id === this.starterId);
            return `
                <hr class="sg-rule">
                <p class="sg-label">${esc(tq('guideStarter', 'Start from a ready-made page'))}</p>
                <p class="sg-sub" data-sg-starter-sub>${esc(sub)}</p>
                <div class="sg-choices" data-sg-starters>${cards}</div>
                <div class="sg-starter-form" data-sg-starter-form${open ? '' : ' hidden'}>
                    <label for="sg-starter-server">${esc(tq('guideStarterServer', 'Your server address'))}</label>
                    <input id="sg-starter-server" type="text" data-sg-starter-server autocomplete="off" value="${esc(this.starterServer)}" placeholder="192.168.1.10">
                    <p class="sg-sub">${esc(tq('guideStarterHint', 'One address fills every service; change single links later.'))}</p>
                    <button type="button" class="sg-btn sg-btn-primary" data-sg-starter-create${this.busy ? ' disabled' : ''}>${esc(tq('guideStarterCreate', 'Create page'))}</button>
                    <p class="sg-error" data-sg-starter-error role="alert"${this.starterError ? '' : ' hidden'}>${esc(this.starterError)}</p>
                </div>`;
        }

        pickStarter(id) {
            this.starterId = id;
            this.starterError = '';
            this.renderModal();
            this.overlay?.querySelector('[data-sg-starter-server]')?.focus({ preventScroll: true });
        }

        async createStarter() {
            const id = this.starterId;
            if (!id || this.busy) return;
            this.busy = true;
            this.starterError = '';
            const showError = (message) => {
                this.starterError = message;
                const el = this.overlay?.querySelector('[data-sg-starter-error]');
                if (el) { el.textContent = message; el.hidden = false; }
            };
            let replaced = false;
            try {
                const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
                const res = await api('/api/onboarding/template', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, server: this.starterServer.trim() }),
                });
                if (!res.ok) {
                    let message = '';
                    try { message = String((await res.json())?.error || ''); } catch { /* no body */ }
                    this.busy = false;
                    showError(message || tq('guideStarterFailed', 'Could not create the page'));
                    return;
                }
                try { replaced = (await res.json())?.replaced === true; } catch { /* treated as added */ }
            } catch {
                this.busy = false;
                showError(tq('guideStarterFailed', 'Could not create the page'));
                return;
            }
            if (STARTER_IDS.includes(id)) global.nextdashTrack?.('start-template', { id, replaced });
            try {
                await this.showPage(MAIN_PAGE_ID);
            } catch { /* the page catches up on the next revision check */ } finally {
                this.busy = false;
                if (replaced) {
                    // The example links are gone: the same answer as Start empty.
                    this.replacesMain = false;
                    this.recordAnswer('empty');
                }
                this.starterId = '';
                this.close();
            }
        }

        /** [code, name] of the browser's language when it is offered and not the current one. */
        languageSuggestion() {
            if (this.langTouched) return null;
            const base = String(global.navigator?.language || '').toLowerCase().split(/[-_]/)[0];
            const found = LANGUAGES.find(([code]) => code === base);
            if (!found) return null;
            return found[0] === (this.dash.settings?.language || 'en') ? null : found;
        }

        acceptLanguage(code) {
            this.langTouched = true;
            global.nextdashTrack?.('language-suggest', { action: 'accepted', to: code });
            void this.setLanguage(code);
        }

        // ---- What the choices do -----------------------------------------------

        recordAnswer(picked) {
            this.state().templatePicked = picked;
            this.save();
        }

        async answer(picked) {
            this.recordAnswer(picked);
            global.nextdashTrack?.('first-start:keep');
            this.close();
        }

        showError(message) {
            const error = this.overlay?.querySelector('[data-sg-error]');
            if (!error) return;
            error.textContent = message;
            error.hidden = false;
        }

        async startEmpty() {
            if (this.busy) return;
            this.busy = true;
            try {
                const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
                const res = await api('/api/onboarding/start-empty', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch {
                this.busy = false;
                this.showError(tf('startEmptyError', 'Could not clear the page'));
                return;
            }
            global.nextdashTrack?.('first-start:empty');
            // The server has cleared the page by now: whatever the reload does,
            // the answer is given and the choice is over.
            try {
                await this.showPage(MAIN_PAGE_ID);
            } catch { /* the page catches up on the next revision check */ } finally {
                this.busy = false;
                this.replacesMain = false;
                this.recordAnswer('empty');
                this.close();
            }
        }

        /** Bring the emptied page on screen without a reload. */
        async showPage(pageId) {
            const d = this.dash;
            // Start empty can take the starter news page away: the tabs follow.
            try {
                const res = await fetch('/api/pages', { cache: 'no-store' });
                if (res.ok) {
                    d.pages = await res.json();
                    d.pageNav?.renderPageNavigation?.();
                }
            } catch { /* the tabs catch up on the next revision check */ }
            d.data?.invalidatePageDataCache?.(pageId);
            await d.data?.loadAllBookmarks?.();
            await d.loadPageBookmarks?.(pageId, { forceFetch: true, skipInlineEditConfirm: true });
            void d.data?.fetchAndStoreDataRevision?.();
        }

        openStudio() {
            this.close({ land: false });
            const d = this.dash;
            void Promise.resolve(d.config?.openThemeBrowser?.()).catch(() => {
                global.location.hash = 'config/appearance';
            });
        }

        // ---- Steps -------------------------------------------------------------

        goTo(hash) {
            this.close({ land: false });
            global.location.hash = hash;
        }

        async runTour() {
            this.close({ land: false });
            await this.dash.promos?.openDashboardTour?.();
        }

        async runStep(id) {
            const step = this.steps().find((s) => s.id === id);
            if (!step) return;
            // Counted before anything moves: a step that leaves the dashboard
            // is where the reader's attention goes next.
            this.markSteps([id]);
            try { await step.run(); } catch { /* a step that cannot run is not an error toast */ }
        }

        // ---- Language and weather ----------------------------------------------

        /**
         * The language, live: the same path as Config → Appearance. The
         * dictionary is loaded again, the dashboard redrawn, and this guide
         * with it, so nothing has to be reloaded to see it.
         */
        async setLanguage(lang) {
            const d = this.dash;
            if (!LANGUAGES.some(([code]) => code === lang)) return;
            const token = ++this.langToken;
            d.settings.language = lang;
            await d.language?.init?.(lang);
            // A later change started while this one was loading: it draws.
            if (token !== this.langToken) return;
            d.renderDashboard?.({ animate: false });
            this.save();
            this.refresh();
            this.renderModal();
            this.overlay?.querySelector('[data-sg-language]')?.focus({ preventScroll: true });
        }

        saveWeather({ city, unit } = {}) {
            const d = this.dash;
            const s = d.settings;
            let changed = false;
            if (typeof city === 'string') {
                const value = city.trim();
                if (value !== (s.weatherLocation || '')) {
                    s.weatherLocation = value;
                    changed = true;
                }
                if (value) {
                    s.weatherSource = 'manual';
                    s.showWeatherWithDate = true;
                }
            }
            if (unit === 'celsius' || unit === 'fahrenheit') {
                if (s.weatherUnit !== unit) { s.weatherUnit = unit; changed = true; }
                this.overlay?.querySelectorAll('[data-sg-unit]').forEach((button) => {
                    button.setAttribute('aria-pressed', String(button.getAttribute('data-sg-unit') === unit));
                });
            }
            if (!changed) return;
            this.save();
            void d.refreshWeather?.(true);
            d.renderDateWeatherLine?.();
        }

        // ---- Finishing ---------------------------------------------------------

        refresh() {
            if (!this.bar) return;
            this.renderBar();
            const progress = this.overlay?.querySelector('[data-sg-progress]');
            if (progress) {
                const { total, count } = this.progress();
                progress.textContent = tq('progress', '{done} of {total} done', { done: count, total });
            }
            // The footer's button turns into "All set" when the last step is done.
            const allSet = this.progress().count >= this.progress().total;
            if (this.overlay && allSet !== this.lastAllSet) {
                this.lastAllSet = allSet;
                this.renderModal();
            }
            const done = this.doneSet();
            this.overlay?.querySelectorAll('[data-sg-step]').forEach((li) => {
                const finished = done.has(li.getAttribute('data-sg-step'));
                li.classList.toggle('is-done', finished);
                li.querySelector('.sg-check')?.classList.toggle('is-done', finished);
            });
        }

        /** Closed for good, or every step done and the bar clicked. */
        complete() {
            const d = this.dash;
            const qs = this.state();
            qs.dismissed = true;
            qs.completedAt = Math.floor(Date.now() / 1000);
            if (d.settings.onboardingCompleted !== true) d.settings.onboardingCompleted = true;
            d.onboardingStartedInSession = false;
            this.save();
            this.teardown();
            this.onDone();
        }

        teardown() {
            this.close({ land: false });
            this.timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
            this.timers = [];
            if (this.hashHandler) global.removeEventListener('hashchange', this.hashHandler);
            this.bar?.remove();
            this.bar = null;
        }
    }

    global.StartGuide = StartGuide;
})(window);
