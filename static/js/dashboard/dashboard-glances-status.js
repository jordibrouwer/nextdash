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

    // The public demo has no Glances: nothing here asks, and nothing shows.
    const DEMO = Boolean(document.querySelector('meta[name="nextdash-demo"]'));

    /**
     * Which Glances host the page is looking at. nextDash can watch several; an
     * empty id is the first. The choice is remembered in this browser, and the
     * address of the page carries it (#glances/overview?host=nas).
     */
    const STORE = 'nextdash:glances-host';
    const Host = {
        id: '',
        load() {
            try { this.id = localStorage.getItem(STORE) || ''; } catch { this.id = ''; }
        },
        set(id) {
            this.id = id || '';
            try {
                if (this.id) localStorage.setItem(STORE, this.id);
                else localStorage.removeItem(STORE);
            } catch { /* a private window: the choice lasts until the page is left */ }
        },
        /** An API address with the host asked for appended. */
        url(address, id = this.id) {
            if (!id) return address;
            return `${address}${address.includes('?') ? '&' : '?'}host=${encodeURIComponent(id)}`;
        },
    };
    Host.load();
    window.DashboardGlancesHost = Host;

    /**
     * The one element helper of the Glances sections: a tag, a class, and text
     * (set as text, never as markup). Loaded here because every section is
     * loaded after this file.
     */
    window.DashboardGlancesDom = {
        /** The reader's own time zone: days and hours are theirs, not the server's. */
        zone() {
            try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
        },
        el(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        },
    };

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

        /** The Glances page exists: switched on, and told where to look. Never in the demo. */
        get configured() {
            return !DEMO && this.state.configured === true;
        }

        /** The connection is switched off: the page and its record stay, nothing is read. */
        get paused() {
            return this.state.paused === true;
        }

        /** Every host, by name: [{ id, name, configured, paused, level, ok }]. */
        get hosts() {
            return Array.isArray(this.state.hosts) ? this.state.hosts : [];
        }

        /** The id of the host being looked at: the one chosen, or the first. */
        get hostId() {
            const known = this.hosts.some((h) => h.id === Host.id);
            return known ? Host.id : (this.hosts[0]?.id || this.state.id || '');
        }

        /** The worst verdict of any host that is being read: the dot on the icon. */
        get level() {
            if (!this.configured) return 'unknown';
            const rank = { bad: 2, warn: 1 };
            const live = this.hosts.filter((h) => h.configured && !h.paused);
            if (!live.length) return this.state.level;
            return live.reduce((worst, h) => ((rank[h.level] || 0) > (rank[worst] || 0) ? h.level : worst), live[0].level);
        }

        async refresh() {
            if (DEMO) return false;
            let next = null;
            try {
                const res = await fetch(Host.url('/api/glances/status'), { cache: 'no-store' });
                if (res.ok) next = await res.json();
            } catch {
                next = null;
            }
            if (!next || typeof next !== 'object') return false;
            const was = `${this.configured}|${this.level}|${this.paused}`;
            this.state = { ...this.state, ...next };
            // A host that no longer exists is not the one being looked at.
            if (Host.id && this.hosts.length && !this.hosts.some((h) => h.id === Host.id)) Host.set('');
            if (was !== `${this.configured}|${this.level}|${this.paused}`) {
                this.dash.pageNav?.renderPageNavigation?.();
            }
            return true;
        }

        start() {
            this.stop();
            // Not part of the demo: nothing to ask, and nothing ever shows.
            if (DEMO) return;
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

        /** The Glances page when it is set up, else the place to set it up. */
        async openGlancesPage() {
            const d = this.dash;
            if (this.configured) {
                return d.glances?.openGlancesView?.({});
            }
            return d.config?.openConfigView?.('glances');
        }
    }

    window.DashboardGlancesStatus = DashboardGlancesStatus;
}());
