/**
 * Quick-start: when a fresh install gets its first-run guide, and when that is
 * finished.
 *
 * What is drawn is the start guide (start-guide.js): a bar at the bottom of the
 * dashboard that opens a modal with the choices, the language, the weather and
 * the first steps. This decides whether to start it (first runs only), keeps
 * the flags in settings.quickStart, and answers the other parts of the app
 * that ask whether the onboarding is still going on.
 *
 * Completion (every step done, or closed for good) sets
 * settings.onboardingCompleted = true, the same flag the old wizard persisted.
 */
(function () {
    'use strict';

    class QuickStart {
        constructor(dashboard) {
            this.dash = dashboard;
            this.language = dashboard?.language || null;
            this.guide = null;
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
            // The apps card waits for the end of the onboarding by itself, so
            // it is asked for here whatever comes first.
            this.offerDiscovery();
            if (!this.shouldStart()) return;
            this.showGuide();
        }

        /**
         * The start guide: a bar and a modal, in place of the first-start card
         * and the checklist that used to follow it one after the other.
         */
        async showGuide() {
            try {
                await window.LazyScript.loadScriptOnce('js/start-guide.js', 'startGuide',
                    () => typeof window.StartGuide === 'function');
            } catch {
                return;
            }
            if (this.guide) return;
            this.guide = new window.StartGuide(this.dash, { onDone: () => { this.guide = null; } });
            await this.guide.show();
        }

        async discoveryInfo() {
            if (this.dash?.settings?.discoverApps === false || this.dash?.settings?.discoveryCardDone === true) return null;
            try {
                const res = await fetch('/api/discovery', { cache: 'no-store' });
                return res.ok ? await res.json() : null;
            } catch {
                return null;
            }
        }

        async loadDiscoveryCard() {
            try {
                await window.LazyScript.loadScriptOnce('js/app-discovery-card.js', 'appDiscoveryCardScript',
                    () => typeof window.AppDiscoveryCard === 'function');
                return true;
            } catch {
                return false;
            }
        }

        /**
         * The apps card, once, for apps without a bookmark. It opens only at
         * the end of the onboarding (AppDiscoveryCard waits for its turn).
         */
        async offerDiscovery() {
            const info = await this.discoveryInfo();
            if (!info || !info.enabled || info.cardDone || !(info.running || (info.docker && info.apps?.length))) return;
            if (!(await this.loadDiscoveryCard()) || !window.AppDiscoveryCard.wanted(info)) return;
            this.discoveryCard = new window.AppDiscoveryCard(this.dash, { onDone: () => { this.discoveryCard = null; } });
            this.discoveryCard.show(info);
        }

        /**
         * Tick the config step when config is actually open.
         *
         * The step used to be ticked by a click handler on `.config-link a`, and
         * that element stopped existing when config became a view of its own
         * rather than a page you navigate to. Nothing else ever set the flag, so
         * the checklist asked a reader to open config and then went on asking
         * after they had — on every fresh install since.
         *
         * Read from the live view instead of listening for a click: refresh()
         * already runs on a timer and on focus, so a tick lands while config is
         * open and the flag is persisted from there.
         */
        latchConfigVisit() {
            if (this.state().visitedConfig === true) return;
            if (this.dash?.activeView !== 'config') return;
            this.state().visitedConfig = true;
            this.saveKeepAlive();
        }

        // A full navigation to /config would race the settings POST, so persist the
        // flag with a keepalive request that survives the page unload. Unlike
        // sendBeacon, keepalive fetch can still send the write-token header.
        // Kept for the addressable `/config` URL, which is still a real way in.
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

        /**
         * Kept for the callers that tell the quick start something changed (the
         * cheat sheet records that it was opened): the guide redraws itself.
         */
        refresh() {
            this.latchConfigVisit();
            this.guide?.refresh?.();
        }

        persistCompleted() {
            const d = this.dash;
            this.state().dismissed = true;
            if (d && d.settings?.onboardingCompleted !== true) {
                d.settings.onboardingCompleted = true;
            }
            this.persistState();
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
