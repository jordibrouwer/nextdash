/**
 * Glances status: does page 0 exist, and how is the machine.
 *
 * Always loaded and small, because the 0 tab, the 0 key and the dot on the tab
 * need it before anything of the Glances page itself is fetched. It asks the
 * server (/api/glances/status) at start and every thirty seconds while the tab
 * is visible, and redraws the page tabs only when what they show changed.
 *
 * The answer carries no address, login or secret: whether Glances is switched
 * on and set up, how often an open page reads, the Overview parts that are
 * hidden, the yellow and red lines, and the sampler's latest verdict
 * (ok, warn, bad, or unknown while the host does not answer).
 */
(function () {
    'use strict';

    class DashboardGlancesStatus {
        static POLL_MS = 30000;

        constructor(dashboard) {
            this.dash = dashboard;
            this.state = {
                enabled: false, configured: false, level: 'unknown', ok: false,
                refresh: 2, hiddenBlocks: [], thresholds: null,
            };
            this._timer = null;
            this._visibility = null;
        }

        /** Page 0 exists: switched on, and told where to look. */
        get configured() {
            return this.state.configured === true;
        }

        /** The connection is switched off: the page and its record stay, nothing is read. */
        get paused() {
            return this.state.paused === true;
        }

        get level() {
            return this.configured ? this.state.level : 'unknown';
        }

        async refresh() {
            let next = null;
            try {
                const res = await fetch('/api/glances/status', { cache: 'no-store' });
                if (res.ok) next = await res.json();
            } catch {
                next = null;
            }
            if (!next || typeof next !== 'object') return false;
            const was = `${this.configured}|${this.state.level}|${this.paused}`;
            this.state = { ...this.state, ...next };
            if (was !== `${this.configured}|${this.state.level}|${this.paused}`) {
                this.dash.pageNav?.renderPageNavigation?.();
            }
            return true;
        }

        start() {
            this.stop();
            void this.refresh();
            this._timer = setInterval(() => {
                if (document.visibilityState !== 'hidden') void this.refresh();
            }, DashboardGlancesStatus.POLL_MS);
            this._visibility = () => {
                if (document.visibilityState !== 'hidden') void this.refresh();
            };
            document.addEventListener('visibilitychange', this._visibility);
        }

        stop() {
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
            if (this._visibility) document.removeEventListener('visibilitychange', this._visibility);
            this._visibility = null;
        }

        /**
         * The 0 key and the 0 tab: the page when Glances is set up, else the
         * place to set it up.
         */
        async openPageZero() {
            const d = this.dash;
            if (this.configured) {
                return d.glances?.openGlancesView?.({});
            }
            return d.config?.openConfigView?.('glances');
        }
    }

    window.DashboardGlancesStatus = DashboardGlancesStatus;
}());
