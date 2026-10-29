/**
 * Config → Widgets: the Catalogue and Custom widget tabs.
 *
 * The Catalogue is every kind on one page, each with a small drawing of what
 * it shows, so a reader can look before adding anything -- the Add modal is
 * the quick way in, this is the place to browse. The Custom tab is the one
 * kind that is a capability rather than a report, explained with a picture of
 * where its figures come from.
 *
 * The drawings are made-up figures in a handful of shapes (rows, a bar, a big
 * number, a spark), not a render of the real widget: the dashboard's own
 * renderers fetch and tick, and a catalogue that called thirty services to
 * show what they look like would be a catalogue that is slow to open.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /*
     * Example figures per kind. Plain strings on purpose: a drawing, hidden
     * from assistive tech, whose words are part of the picture. The Unraid
     * ones match the Unraid section's own preview, so the same tile does not
     * look two ways in two places.
     */
    const SAMPLES = {
        health: { rows: [['broken', '3', 'bad'], ['down now', '1', 'warn'], ['healthy', '412', 'good']] },
        uptime: { big: '99.2%', spark: [90, 95, 60, 100, 97, 100, 99] },
        certs: { rows: [['nas.lan', '12 days', 'warn'], ['git.lan', '71 days', 'good']] },
        domains: { rows: [['photos-home.com', '23 days', 'warn'], ['wiki-intern.org', '212 days', 'good']] },
        trend: { big: '+12', spark: [30, 42, 38, 55, 61, 58, 70] },
        inbox: { big: '14', rows: [['oldest', '3 days']] },
        unsorted: { big: '27', rows: [['newest', 'today']] },
        feeds: { rows: [['Changelog', '2 new', 'good'], ['Blog', '—']] },
        sources: { rows: [['extension', '41'], ['bookmarklet', '7']] },
        neglected: { big: '38', rows: [['not opened in', '6 months']] },
        unchecked: { big: '19', rows: [['never checked', '19', 'warn']] },
        duplicates: { big: '5', rows: [['same address', '5']] },
        archive: { rows: [['saved whole', '128']], bars: [['disk', 0.4]] },
        trash: { big: '9', rows: [['emptied in', '21 days']] },
        backups: { rows: [['last', '2 h ago', 'good'], ['kept', '14']] },
        cpu: { pulse: ['load', '23%'], bars: [['', 0.23]] },
        memory: { rows: [['used', '11.2 / 32 GB']], bars: [['', 0.35]] },
        disks: { bars: [['/', 0.61], ['/mnt/data', 0.88, 'warn']] },
        docker: { rows: [['running', '12', 'good'], ['stopped', '1', 'warn']] },
        containers: { rows: [['updates', '3', 'warn'], ['healthy', '14', 'good']] },
        unraid: { rows: [['array', 'started', 'good'], ['alerts', '2 unread', 'warn']] },
        unraidArray: { bars: [['disk1', 0.74]] },
        unraidParity: { bars: [['check', 0.63]] },
        unraidShares: { rows: [['array', '44%'], ['cache', '13%']] },
        unraidVms: { pulse: ['home-assistant', 'on'] },
        unraidUps: { bars: [['battery', 1, 'good']] },
        unraidNotifications: { rows: [['parity check', 'done'], ['2 alerts', '', 'warn']] },
        weather: { big: '14°', rows: [['rain', '30%']] },
        calendar: { rows: [['09:30', 'Stand-up'], ['14:00', 'Dentist']] },
        rss: { rows: [['Release 2.4 is out', ''], ['A note on caching', '']] },
        notes: { rows: [['☑ renew domain', ''], ['☐ swap disk', '']] },
        jellyfin: { rows: [['Severance', 'S2E4'], ['Dune: Part Two', 'film']] },
        emby: { rows: [['Severance', 'S2E4'], ['Dune: Part Two', 'film']] },
        plex: { rows: [['Severance', 'S2E4'], ['Dune: Part Two', 'film']] },
        sonarr: { rows: [['The Bear', 'tonight'], ['Andor', '62%', 'good']] },
        radarr: { rows: [['Mickey 17', 'Friday'], ['Flow', 'queued']] },
        seerr: { rows: [['Shōgun', 'asked'], ['Wicked', 'arrived', 'good']] },
        qbittorrent: { rows: [['↓ 12.4 MB/s', '']], bars: [['ubuntu-24.10.iso', 0.81]] },
        sabnzbd: { rows: [['queue', '3 · 4.1 GB'], ['↓ 38 MB/s', '']] },
        beszel: { rows: [['nas', 'disk 88%', 'warn'], ['htpc', 'cpu 23%'], ['pihole', 'down', 'bad']] },
        'beszel-system': { rows: [['nas', ''], ['temp', '54°']], bars: [['cpu', 0.23], ['mem', 0.61], ['disk', 0.88, 'warn']] },
        'beszel-attention': { rows: [['nas', 'disk 88%', 'warn'], ['pihole', 'down', 'bad']] },
        'beszel-storage': { bars: [['nas /', 0.88, 'warn'], ['htpc /', 0.41]] },
        glances: { rows: [['Home', 'healthy']], bars: [['cpu', 0.22], ['mem', 0.61], ['disk', 0.83, 'warn']] },
        custom: { rows: [['queued', '7'], ['paused', '2']] },
    };

    /*
     * Kinds that arrived recently, and the minor release they arrived in.
     *
     * The badge reads the release the server says it is and goes away by
     * itself one minor later, so nobody has to remember to take it off. With
     * no release to read -- an index that would not parse -- it shows: a
     * badge too many is cheaper than a new widget nobody spots.
     */
    const NEW_SINCE = {
        jellyfin: '1.20',
        'jellyfin-playing': '1.20',
        emby: '1.20',
        'emby-playing': '1.20',
        plex: '1.20',
        'plex-playing': '1.20',
        sonarr: '1.20',
        radarr: '1.20',
        seerr: '1.20',
        qbittorrent: '1.20',
        sabnzbd: '1.20',
        homeassistant: '1.20',
        beszel: '1.20',
        'beszel-system': '1.20',
        'beszel-attention': '1.20',
        'beszel-storage': '1.20',
    };

    /** "v1.19.4" -> [1, 19]; anything else, an old date tag included, -> null. */
    function majorMinor(tag) {
        const match = /^v?(\d+)\.(\d+)(?:\.|$)/.exec(String(tag || '').trim());
        if (!match || Number(match[1]) > 100) return null;
        return [Number(match[1]), Number(match[2])];
    }

    function releaseNow() {
        return majorMinor(global.document?.querySelector?.('meta[name="nextdash-release"]')?.content);
    }

    Object.assign(global.DashboardConfig.prototype, {

    /** Whether a kind still wears the New badge in this release. */
    isWidgetTypeNew(type) {
        const since = majorMinor(NEW_SINCE[type]);
        if (!since) return false;
        const now = releaseNow();
        if (!now) return true;
        return now[0] < since[0] || (now[0] === since[0] && now[1] <= since[1]);
    },

    /** The kinds that are new, in catalogue order. */
    newWidgetTypes() {
        return DashboardConfig.WIDGET_TYPE_GROUPS
            .flatMap(([, types]) => types)
            .filter((type) => this.isWidgetTypeNew(type));
    },

    /** The badge itself; empty for a kind that is not new. */
    renderWidgetNewBadge(type) {
        if (!this.isWidgetTypeNew(type)) return '';
        return `<span class="config-widget-new-badge">${
            this.dash.escapeHtml(this.t('config.widgetNewBadge', 'New'))}</span>`;
    },

    /** One kind's drawing, in the Unraid preview's vocabulary of rows and bars. */
    renderWidgetSample(type) {
        const esc = (v) => this.dash.escapeHtml(v);
        const sample = SAMPLES[type] || { rows: [[this.widgetTypeName(type), '']] };
        const tone = (name) => (name ? ` class="config-widget-kind-${name}"` : '');
        const parts = [];
        if (sample.big) parts.push(`<span class="config-widget-kind-big">${esc(sample.big)}</span>`);
        if (sample.pulse) {
            parts.push(`<span class="unraid-mini-row"><span><span class="unraid-mini-pulse"></span>${
                esc(sample.pulse[0])}</span><span class="config-widget-kind-good">${esc(sample.pulse[1])}</span></span>`);
        }
        (sample.rows || []).forEach(([name, value, t]) => {
            parts.push(`<span class="unraid-mini-row"><span>${esc(name)}</span><span${tone(t)}>${esc(value)}</span></span>`);
        });
        (sample.bars || []).forEach(([name, fill, t]) => {
            if (name) {
                parts.push(`<span class="unraid-mini-row"><span>${esc(name)}</span><span${tone(t)}>${
                    esc(`${Math.round(fill * 100)}%`)}</span></span>`);
            }
            parts.push(`<span class="unraid-mini-bar${t ? ` unraid-mini-bar--${t}` : ''}"><i style="--fill:${fill}"></i></span>`);
        });
        if (sample.spark) {
            const max = Math.max(...sample.spark);
            parts.push(`<span class="config-widget-kind-spark">${sample.spark.map((value, j) =>
                `<i style="--h:${Math.round((value / max) * 100)};--j:${j}"></i>`).join('')}</span>`);
        }
        return parts.join('');
    },

    /** How many of each kind the list holds, for the "on this page" badge. */
    widgetKindCounts() {
        const counts = {};
        (this._widgetBlocks || []).forEach((block) => {
            if (block?.isWidget) counts[block.type] = (counts[block.type] || 0) + 1;
        });
        return counts;
    },

    });

    global.DashboardConfigWidgetCatalogueReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
