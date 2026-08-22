/**
 * One dated stream, three sources.
 *
 * The overview used to answer "what is new" in three places at once: a
 * carousel of 49 feature spotlights showing one at a time, a Latest update
 * panel repeating the release the update bar already named, and — once the
 * site's feed arrived — a third list beside them. Three visual weights, three
 * scopes, and no way to tell which was which.
 *
 * Everything here carries a moment, so it can all go in one list, newest
 * first, each row saying where it came from:
 *
 *   site     — a post on nextdash.cc, fetched by the server (site_news.go)
 *   release  — a release, from the what's-new index every other surface reads
 *   feature  — a setting worth knowing about, from overview-features.json
 *
 * The back catalogue of features carries no date (see the `since` note in
 * scripts/validate-overview-features.cjs); undated items sort last and are
 * left to the drill-in rather than pushed into the stream.
 */
(function () {
    'use strict';

    /** What the overview shows before "All news & features" is needed. */
    const OVERVIEW_LIMIT = 6;
    /** Undated features would otherwise crowd out everything with a date. */
    const FEATURE_RELEASES_IN_STREAM = 2;
    /**
     * How many releases join the stream.
     *
     * The index holds every release ever shipped — 145 of them — and a stream
     * of release tags is not news, it is a changelog. The recent ones sit
     * beside the posts announcing them; the rest live in What's new and the
     * drill-in.
     */
    const RELEASES_IN_STREAM = 5;
    const SEEN_KEY = 'nextdash:news-seen-v1';

    const SOURCES = ['site', 'release', 'feature'];

    /**
     * Read the release index once. It is the same file the ★ modal and Help's
     * version heading read, so the three cannot disagree about what shipped.
     */
    async function fetchReleases() {
        const version = window.NEXTDASH_WHATS_NEW_DATA_VERSION || '';
        const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
        const res = await fetch(`/static/data/whats-new/index.json${suffix}`);
        if (!res.ok) return [];
        const index = await res.json();
        return Array.isArray(index) ? index : [];
    }

    async function fetchSiteNews() {
        try {
            const res = await fetch('/api/site-news');
            if (!res.ok) return { enabled: false, items: [] };
            const doc = await res.json();
            return {
                enabled: doc?.enabled !== false,
                items: Array.isArray(doc?.items) ? doc.items : [],
                fetchedAt: Number(doc?.fetchedAt || 0) || 0,
            };
        } catch (_error) {
            // Offline, blocked, or the site is down. The stream still has
            // releases and features, which need no network at all.
            return { enabled: true, items: [], failed: true };
        }
    }

    /** `2026-08-21` → epoch ms; releases carry a date, not a timestamp. */
    function releaseTime(entry) {
        const at = Date.parse(`${entry?.releasedAt || ''}T12:00:00Z`);
        return Number.isFinite(at) ? at : 0;
    }

    /**
     * Build the stream.
     *
     * Features inherit the date of the release they landed in, so a setting
     * introduced in 1.3.0 sits beside the post announcing 1.3.0 rather than
     * floating at the top forever.
     */
    function buildStream({ site, releases, features }) {
        const releaseTimes = new Map();
        (releases || []).forEach((entry) => {
            if (entry?.tag) releaseTimes.set(entry.tag, releaseTime(entry));
        });
        const recent = (releases || []).slice(0, FEATURE_RELEASES_IN_STREAM).map((r) => r.tag);

        const items = [];

        (site?.items || []).forEach((post) => {
            items.push({
                source: 'site',
                id: `site:${post.url}`,
                title: post.title,
                summary: post.summary || '',
                at: Number(post.publishedAt) || 0,
                url: post.url,
            });
        });

        (releases || []).slice(0, RELEASES_IN_STREAM).forEach((entry) => {
            if (!entry?.tag) return;
            items.push({
                source: 'release',
                id: `release:${entry.tag}`,
                title: entry.tag,
                summary: entry.date || '',
                at: releaseTime(entry),
                action: 'whats-new',
            });
        });

        (features || []).forEach((feature) => {
            // Only the current releases' features belong in the stream; the
            // back catalogue is a reference list, not news.
            if (!feature?.since || !recent.includes(feature.since)) return;
            items.push({
                source: 'feature',
                id: `feature:${feature.titleKey}`,
                title: feature.titleFallback,
                titleKey: feature.titleKey,
                summary: feature.whatFallback,
                summaryKey: feature.whatKey,
                ctaKey: feature.ctaKey,
                ctaFallback: feature.ctaFallback,
                at: releaseTimes.get(feature.since) || 0,
                since: feature.since,
                go: feature.go,
            });
        });

        // Newest first; an item with no date sorts last rather than as 1970.
        items.sort((a, b) => (b.at || 0) - (a.at || 0));
        return items;
    }

    /**
     * The moment the reader last looked, kept in this browser.
     *
     * A first visit stamps now rather than zero: everything ever published
     * counting as unread would put a badge of 156 on Overview and teach the
     * reader to ignore it on day one. From then on the dot means what it says.
     */
    function readSeenAt() {
        try {
            const stored = Number(localStorage.getItem(SEEN_KEY));
            if (stored > 0) return stored;
            const now = Date.now();
            localStorage.setItem(SEEN_KEY, String(now));
            return now;
        } catch (_error) {
            // A browser refusing storage means everything reads as seen, which
            // is quieter than everything reading as new for ever.
            return Date.now();
        }
    }

    function markSeen(at) {
        try {
            localStorage.setItem(SEEN_KEY, String(Number(at) || Date.now()));
        } catch (_error) { /* nothing to do: the dot simply stays */ }
    }

    function unreadCount(items, seenAt) {
        return (items || []).filter((item) => (item.at || 0) > seenAt).length;
    }

    window.DashboardNewsStream = {
        OVERVIEW_LIMIT,
        SOURCES,
        fetchReleases,
        fetchSiteNews,
        buildStream,
        readSeenAt,
        markSeen,
        unreadCount,
    };
})();
