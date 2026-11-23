/**
 * Config → About: the tab strip's wiring, the diagnostics and the licence list.
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

    Object.assign(global.DashboardConfig.prototype, {

    /** The two About tabs, plus the buttons the news tab carries. */
    bindAboutTabs(container) {
        const body = container.querySelector('#config-view-body') || container;
        if (body.dataset.aboutBound === '1') return;
        body.dataset.aboutBound = '1';
        // `toggle` does not bubble, so it is caught on the way down.
        body.addEventListener('toggle', (e) => {
            if (this.section === 'about' && e.target.matches?.('[data-about-credits]') && e.target.open) void this.loadLicences();
        }, true);
        body.addEventListener('click', (e) => {
            if (this.section !== 'about') return;
            const tab = e.target.closest('[data-about-tab]');
            if (tab) {
                this.aboutTab = DashboardConfig.normalizeAboutTab(tab.getAttribute('data-about-tab'));
                this._trackAction('subtab', { section: 'about', tab: this.aboutTab, via: 'click' });
                this.render();
                this.restoreConfigHash();
                return;
            }
            const chip = e.target.closest('[data-news-filter]');
            if (chip) {
                const next = window.DashboardNewsStream?.SOURCES?.includes(chip.getAttribute('data-news-filter'))
                    ? chip.getAttribute('data-news-filter')
                    : 'all';
                this.newsFilter = this.newsFilter === next ? 'all' : next;
                this.render();
                return;
            }
            if (e.target.closest('[data-about-action="copy-diagnostics"]')) {
                void this.copyDiagnostics();
                return;
            }
            const go = e.target.closest('[data-overview-go]');
            if (go) this.handleOverviewGo(go);
        });
    },

    /**
     * The Markdown a bug report needs. Counts and on/off names only: never a
     * bookmark name or address, the data path, a token or a setting's value.
     */
    buildDiagnostics() {
        const info = this._aboutInfo || {};
        const status = this._updateStatus || {};
        const s = this.computeStats();
        const settings = this.dash.settings || {};
        const features = Object.entries(DashboardConfig.HELP_PANEL_FEATURES)
            .filter(([, f]) => f.isOn(settings))
            .map(([key]) => this.t(key, key));
        const unknown = 'unknown';
        const lines = [
            '### nextDash',
            `- Release: ${status.current || info.release || unknown}`,
            `- Build: ${[info.buildVersion, info.buildCommit].filter((v) => v && v !== 'unknown').join(' ') || unknown}${info.buildDate ? ` (${info.buildDate})` : ''}`,
            status.latest ? `- Latest on GitHub: ${status.latest}` : '',
            '',
            '### Environment',
            `- Platform: ${info.os ? `${info.os}/${info.arch}` : unknown}`,
            `- Go: ${info.goVersion || unknown}`,
            `- Uptime: ${info.uptimeSeconds !== undefined ? DashboardConfig.formatUptime(info.uptimeSeconds) : unknown}`,
            `- Data size: ${info.dataBytes ? this.formatBytes(info.dataBytes) : unknown}`,
            '',
            '### Counts',
            `- Pages: ${(this.dash.pages || []).length}`,
            `- Categories: ${s.categories}`,
            `- Bookmarks: ${(this.dash.allBookmarks || []).length}`,
            `- Widgets: ${this._statsLibrary && this._statsLibrary.widgets !== null ? this._statsLibrary.widgets : unknown}`,
            `- Tags: ${s.tagCount}`,
            '',
            '### Features on',
            features.length ? features.map((f) => `- ${f}`).join('\n') : '- none of the optional ones',
            '',
            '### Browser',
            `- ${navigator.userAgent}`,
            `- Language: ${navigator.language || unknown}`,
            `- Screen: ${window.innerWidth}x${window.innerHeight}`,
            `- Theme: ${settings.theme || unknown}`,
        ];
        return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
    },

    async copyDiagnostics() {
        const text = this.buildDiagnostics();
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch {
            // Plain-HTTP LAN installs have no Clipboard API.
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            try { copied = document.execCommand('copy'); } catch { copied = false; }
            area.remove();
        }
        this.notify(copied
            ? this.t('config.aboutDiagCopied', 'Diagnostics copied.')
            : this.t('config.aboutDiagFailed', 'Could not copy. Select the text and copy it by hand.'), copied ? 'success' : 'error');
    },

    /** Fetch the licence list the first time the credits are opened. */
    async loadLicences() {
        if (this._licences !== undefined) return;
        try {
            const res = await fetch('/static/data/licenses.json');
            this._licences = res.ok ? await res.json() : null;
        } catch {
            this._licences = null;
        }
        const target = document.querySelector('[data-about-licences]');
        if (target) target.innerHTML = this.renderLicenceList();
    }

    });

    global.DashboardConfigAboutReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
