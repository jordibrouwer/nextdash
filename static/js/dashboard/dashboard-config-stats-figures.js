/**
 * Config → Statistics, the figures behind the panels.
 *
 * Pure functions over bookmarks, health points and timestamps: no DOM, no
 * fetch, no translation. The renderers in dashboard-config-stats.js draw what
 * these return, and the tests call them directly with hand-built data, so a
 * figure can be checked without drawing the panel it sits in.
 *
 * Loaded with the renderers, just before them.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const DAY = 86400000;

    /** Local midnight of the day holding `ts`. */
    const dayStart = (ts) => {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    };

    /** Whole local days from `from` to `to`, safe across a clock change. */
    const daysBetween = (from, to) => Math.round((dayStart(to) - dayStart(from)) / DAY);

    const openLogOf = (b) => (Array.isArray(b?.openLog) ? b.openLog : [])
        .map(Number)
        .filter((ts) => Number.isFinite(ts) && ts > 0);

    /*
     * Hosts that live on the reader's own network rather than the internet:
     * addresses, and the names home networks and tailnets hand out.
     */
    const SELF_HOSTED_SUFFIXES = ['.local', '.lan', '.home', '.internal', '.home.arpa', '.ts.net', '.localhost'];
    const isIPv4 = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const isSelfHosted = (host) => host === 'localhost'
        || isIPv4(host)
        || host.startsWith('[')
        || SELF_HOSTED_SUFFIXES.some((suffix) => host.endsWith(suffix));

    Object.assign(global.DashboardConfig.prototype, {

        /**
         * The healthy share per recorded day, one slot per calendar day.
         *
         * Worked out from broken, monitors down and unchecked rather than from
         * the stored healthy count: that count changed meaning in August 2026,
         * when stale and unused stopped counting against a bookmark, so the
         * old points read 28% for a collection with one broken link. The three
         * counts it is worked out from were recorded the same way all along.
         * A day without a point is a gap (null), not a straight line.
         */
        statsHealthySeries(points) {
            const list = (Array.isArray(points) ? points : [])
                .filter((p) => Number(p?.t) > 0)
                .sort((a, b) => Number(a.t) - Number(b.t));
            if (!list.length) return [];
            const first = Number(list[0].t);
            const last = Number(list[list.length - 1].t);
            const out = [];
            const length = daysBetween(first, last) + 1;
            for (let i = 0; i < length; i++) {
                const at = new Date(first);
                at.setDate(at.getDate() + i);
                out.push({ t: at.getTime(), pct: null });
            }
            list.forEach((p) => {
                const n = Number(p.n) || 0;
                if (!n) return;
                const bad = (Number(p.b) || 0) + (Number(p.d) || 0) + (Number(p.u) || 0);
                const slot = out[daysBetween(first, Number(p.t))];
                if (slot) slot.pct = Math.max(0, Math.round(((n - bad) / n) * 100));
            });
            return out;
        },

        /**
         * Opens per period from each bookmark's openLog.
         *
         * The real series: every open, when it happened. Buckets are days up
         * to a month, weeks up to three months and 30-day blocks beyond, the
         * same as the last-used chart, so switching between the two keeps the
         * bars in the same places. `span` is how far back the log reaches,
         * which decides whether this chart is worth showing by default, and
         * `prevTotal` is only given when the log covers the previous window
         * in full: a half-recorded period compared against a whole one would
         * always look like growth.
         */
        statsOpenLogSeries(bookmarks, days, now = Date.now()) {
            const range = Number(days) || 30;
            const bucketDays = range <= 30 ? 1 : (range <= 90 ? 7 : 30);
            const bucketCount = Math.max(1, Math.round(range / bucketDays));
            const windowDays = bucketCount * bucketDays;
            const start = new Date(dayStart(now));
            start.setDate(start.getDate() - (windowDays - 1));
            const startAt = start.getTime();
            const prevStart = new Date(startAt);
            prevStart.setDate(prevStart.getDate() - windowDays);
            const prevAt = prevStart.getTime();

            const buckets = new Array(bucketCount).fill(0);
            let total = 0;
            let prev = 0;
            let oldest = 0;
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                openLogOf(b).forEach((ts) => {
                    if (ts > now) return;
                    if (!oldest || ts < oldest) oldest = ts;
                    if (ts >= startAt) {
                        const idx = Math.min(bucketCount - 1, Math.floor(daysBetween(startAt, ts) / bucketDays));
                        buckets[idx] += 1;
                        total += 1;
                    } else if (ts >= prevAt) {
                        prev += 1;
                    }
                });
            });
            const dates = buckets.map((_, i) => {
                const d = new Date(startAt);
                d.setDate(d.getDate() + i * bucketDays);
                return d.getTime();
            });
            const span = oldest ? Math.floor((now - oldest) / DAY) : 0;
            return {
                buckets,
                dates,
                bucketDays,
                span,
                total,
                prevTotal: oldest && oldest < prevAt + DAY ? prev : null,
            };
        },

        /** Opens by weekday (Monday first) and hour, in the reader's own time. */
        statsOpenHeatmap(bookmarks) {
            const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
            let total = 0;
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                openLogOf(b).forEach((ts) => {
                    const d = new Date(ts);
                    grid[(d.getDay() + 6) % 7][d.getHours()] += 1;
                    total += 1;
                });
            });
            return { grid, total };
        },

        /** Every bookmark by how long ago it was last opened. */
        statsRecency(bookmarks, now = Date.now()) {
            const bands = { lt7: 0, d7_30: 0, d30_90: 0, gt90: 0, never: 0 };
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                const last = Number(b?.lastOpened) || 0;
                if (!last) { bands.never += 1; return; }
                const age = (now - last) / DAY;
                if (age < 7) bands.lt7 += 1;
                else if (age < 30) bands.d7_30 += 1;
                else if (age < 90) bands.d30_90 += 1;
                else bands.gt90 += 1;
            });
            return Object.entries(bands);
        },

        /** Every bookmark by how many times it has been opened. */
        statsOpenCountBands(bookmarks) {
            const bands = { 0: 0, 1: 0, '2-4': 0, '5-9': 0, '10+': 0 };
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                const n = Number(b?.openCount) || 0;
                if (n <= 0) bands[0] += 1;
                else if (n === 1) bands[1] += 1;
                else if (n < 5) bands['2-4'] += 1;
                else if (n < 10) bands['5-9'] += 1;
                else bands['10+'] += 1;
            });
            return ['0', '1', '2-4', '5-9', '10+'].map((k) => [k, bands[k]]);
        },

        /**
         * The running share of all opens, bookmark by bookmark from the busiest.
         *
         * One number ("the top ten take 39%") answers one cut; the curve shows
         * every cut at once, and how far it bows from the diagonal is how
         * narrow the habit is.
         */
        statsConcentrationCurve(bookmarks) {
            const opens = (Array.isArray(bookmarks) ? bookmarks : [])
                .map((b) => Number(b?.openCount) || 0)
                .filter((n) => n > 0)
                .sort((a, b) => b - a);
            const total = opens.reduce((sum, n) => sum + n, 0);
            const points = [[0, 0]];
            let running = 0;
            opens.forEach((n, i) => {
                running += n;
                points.push([i + 1, total ? Math.round((running / total) * 100) : 0]);
            });
            const marks = {};
            [1, 5, 10, 20].forEach((rank) => {
                if (rank <= opens.length) marks[rank] = points[rank][1];
            });
            return { points, marks, total, used: opens.length };
        },

        /** Hosts, the self-hosted share and the top-level domains. */
        statsDomains(bookmarks) {
            const hosts = new Map();
            const tlds = new Map();
            let selfHosted = 0;
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                let host = '';
                try {
                    host = new URL(String(b?.url || '')).hostname.toLowerCase();
                } catch {
                    return;
                }
                if (!host) return;
                host = host.replace(/^www\./, '');
                hosts.set(host, (hosts.get(host) || 0) + 1);
                if (isSelfHosted(host)) {
                    selfHosted += 1;
                    return;
                }
                const tld = host.split('.').pop();
                if (tld) tlds.set(tld, (tlds.get(tld) || 0) + 1);
            });
            const byCount = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
            const counted = [...hosts.values()].reduce((sum, n) => sum + n, 0);
            return {
                hosts: [...hosts.entries()].sort(byCount),
                unique: hosts.size,
                selfHosted,
                internet: counted - selfHosted,
                tlds: [...tlds.entries()].sort(byCount),
            };
        },

        /** How long ago bookmarks were saved, with the ones that carry no date. */
        statsAge(bookmarks, now = Date.now()) {
            const bands = { lt30: 0, d30_90: 0, d90_180: 0, gt180: 0, undated: 0 };
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                const at = Number(b?.createdAt) || 0;
                if (!at) { bands.undated += 1; return; }
                const age = (now - at) / DAY;
                if (age < 30) bands.lt30 += 1;
                else if (age < 90) bands.d30_90 += 1;
                else if (age < 180) bands.d90_180 += 1;
                else bands.gt180 += 1;
            });
            return Object.entries(bands);
        },

        /** Bookmarks by how many tags they carry. */
        statsTagsPerBookmark(bookmarks) {
            const bands = { 0: 0, 1: 0, 2: 0, '3+': 0 };
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                const n = (Array.isArray(b?.tags) ? b.tags : []).filter((t) => String(t || '').trim()).length;
                if (n >= 3) bands['3+'] += 1;
                else bands[n] += 1;
            });
            return ['0', '1', '2', '3+'].map((k) => [k, bands[k]]);
        },

        /**
         * Added per calendar month over the last twelve, empty months kept.
         *
         * The old series listed only months that had something in them, so a
         * quiet month vanished and its neighbours closed up as if it had never
         * been. `running` is the dated collection's size at the end of each
         * month, counting what was added before the window too.
         */
        statsGrowthMonths(bookmarks, now = Date.now()) {
            const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const end = new Date(now);
            const months = [];
            for (let i = 11; i >= 0; i--) {
                months.push([key(new Date(end.getFullYear(), end.getMonth() - i, 1)), 0]);
            }
            const index = new Map(months.map(([k], i) => [k, i]));
            const firstKey = months[0][0];
            let before = 0;
            let undated = 0;
            (Array.isArray(bookmarks) ? bookmarks : []).forEach((b) => {
                const at = Number(b?.createdAt) || 0;
                if (!at) { undated += 1; return; }
                const k = key(new Date(at));
                if (index.has(k)) months[index.get(k)][1] += 1;
                else if (k < firstKey) before += 1;
            });
            let sum = before;
            const running = months.map(([, n]) => (sum += n));
            return { months, running, undated };
        },
    });

    global.DashboardConfigStatsFiguresReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
