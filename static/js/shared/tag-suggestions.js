/**
 * What tags a bookmark could take, worked out from the ones you already gave
 * its neighbours.
 *
 * Pure on purpose: items in, groups out, no DOM and no knowledge of how the
 * app stores a bookmark. That is what lets the same rules run in the config
 * panel, on the dashboard, and — if the browser extension ever wants them —
 * in Go, without three implementations drifting apart.
 */
(function (global) {
    'use strict';

    const DEFAULTS = { minGroup: 3, minShare: 0.6, maxPerBookmark: 2 };

    /*
     * How many of a page's own words have to land on one subject.
     *
     * Two, not one. A single shared word is a coincidence often enough to be
     * worthless -- "charts" belongs to finance and to music, "python" to code
     * and to wildlife -- and a wrong tag offered on one word's evidence is
     * worse than no row at all, because the reader has to work out why it is
     * there before they can refuse it.
     */
    const MIN_KEYWORD_HITS = 2;

    /*
     * The pseudo-pattern a page-text row carries where the others carry a host.
     *
     * These rows are grouped by subject across sites, so there is no host to
     * name. It is a real string rather than an empty one because it is half of
     * the key a refusal is stored under, and it is written in the shape
     * sanitizeDismissedTagSuggestions accepts.
     */
    const TEXT_PATTERN = 'page-text';
    const EMPTY = new Set();

    /*
     * A URL becomes at most two patterns: the host, and the host with its
     * FIRST path segment. One domain often carries several subjects -- a
     * site's /docs is not its /blog -- and the first segment is usually where
     * that difference lives. Anything deeper is a page rather than a subject.
     *
     * This is the whole vocabulary: nothing below the first segment is ever
     * emitted, so nothing below it can ever be matched. sanitizeTagRules() in
     * internal/app/handlers.go refuses to store a rule the shape of which this
     * function cannot produce.
     */
    function patternsFor(url) {
        let parsed;
        try {
            parsed = new URL(String(url || ''));
        } catch (error) {
            return [];
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (!host) return [];
        const segment = parsed.pathname.split('/').filter(Boolean)[0];
        return segment ? [host, `${host}/${segment.toLowerCase()}`] : [host];
    }

    function tagsOf(item) {
        return Array.isArray(item.tags)
            ? item.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
            : [];
    }

    /** Every item that a pattern covers, keyed by that pattern. */
    function groupByPattern(items, patternsOf) {
        const byPattern = new Map();
        items.forEach((item) => {
            (patternsOf.get(item) || []).forEach((pattern) => {
                const bucket = byPattern.get(pattern) || [];
                bucket.push(item);
                byPattern.set(pattern, bucket);
            });
        });
        return byPattern;
    }

    /*
     * The tag a group agrees on, or nothing.
     *
     * The share is counted over the *tagged* members rather than all of them:
     * a host where three of thirty carry #code still says something about the
     * three, and demanding a majority of thirty would silence every group that
     * has only begun to be tagged.
     *
     * But the share alone let the thinnest evidence produce the widest row:
     * two bookmarks of thirty carrying #todo agreed unanimously, and offered
     * #todo to the other twenty-eight. So the tag has to appear on at least
     * minEvidence bookmarks before it counts as something the group agreed on
     * -- the same three the empty panel asks the reader for.
     */
    function dominantTag(members, minShare, minEvidence) {
        const counts = new Map();
        let tagged = 0;
        members.forEach((item) => {
            const tags = tagsOf(item);
            if (!tags.length) return;
            tagged += 1;
            new Set(tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
        });
        if (tagged < 2) return null;
        let best = null;
        counts.forEach((count, tag) => {
            if (!best || count > best.have) best = { tag, have: count };
        });
        if (!best || best.have < minEvidence) return null;
        if (best.have / tagged < minShare) return null;
        return { tag: best.tag, have: best.have, of: tagged };
    }

    /*
     * host -> {tag, aliases}, built once per call.
     *
     * The catalogue ships as a list of subjects, each naming the sites that
     * belong to it; matching goes the other way, so it is turned inside out
     * here rather than scanned per bookmark.
     */
    function catalogueByHost(catalogue) {
        const byHost = new Map();
        (Array.isArray(catalogue) ? catalogue : []).forEach((entry) => {
            const tag = String(entry?.tag || '').trim().toLowerCase();
            if (!tag) return;
            const aliases = (Array.isArray(entry?.aliases) ? entry.aliases : [])
                .map((alias) => String(alias).trim().toLowerCase())
                .filter(Boolean);
            (Array.isArray(entry?.hosts) ? entry.hosts : []).forEach((host) => {
                const key = String(host).trim().toLowerCase().replace(/^www\./, '');
                // First entry wins: a host named twice in a shipped file is a
                // mistake in the file, and picking one quietly beats proposing
                // two subjects for one site.
                if (key && !byHost.has(key)) byHost.set(key, { tag, aliases });
            });
        });
        return byHost;
    }

    /*
     * Your word for the catalogue's subject, if you have one.
     *
     * The catalogue supplies the subject; the reader's own tags supply the
     * name. If it says `dev` and every GitHub link here is already tagged
     * #code, the suggestion is #code -- otherwise a shipped vocabulary splits
     * a tidy collection into two tags for one thing. The tag itself wins over
     * an alias when the reader uses both.
     */
    function inTheirWords(entry, vocabulary) {
        if (vocabulary.has(entry.tag)) return entry.tag;
        const known = entry.aliases.find((alias) => vocabulary.has(alias));
        return known || entry.tag;
    }

    /*
     * Proposals, most specific first.
     *
     * A rule is something you wrote down, so it outranks a pattern the app
     * merely noticed; and within what it noticed, host-plus-segment outranks
     * the bare host, because the narrower group is the better guess.
     *
     * Rank decides who wins a conflict, not what the reader sees first: the
     * rendered order is by group size at the bottom of this function, so a
     * 45-item host does not sit under a 3-item segment merely for being less
     * specific.
     */
    function suggest(items, options) {
        const settings = { ...DEFAULTS, ...(options || {}) };
        const rows = Array.isArray(items) ? items.filter((item) => item && item.key && item.url) : [];
        const proposals = [];

        // Parsed once per item rather than once per item per rule: this used to
        // re-parse every URL inside the rule loop, which is the whole cost of
        // suggest() on a large collection with a real rule list behind it.
        const patternsOf = new Map();
        rows.forEach((item) => patternsOf.set(item, patternsFor(item.url)));

        (settings.rules || []).forEach((rule) => {
            const tag = String(rule.tag || '').trim().toLowerCase();
            const pattern = String(rule.pattern || '').trim().toLowerCase();
            if (!tag || !pattern) return;
            const keys = rows
                .filter((item) => (patternsOf.get(item) || []).includes(pattern) && !tagsOf(item).includes(tag))
                .map((item) => item.key);
            if (keys.length) {
                proposals.push({ tag, pattern, reason: { kind: 'rule' }, keys, rank: 0 });
            }
        });

        groupByPattern(rows, patternsOf).forEach((members, pattern) => {
            if (members.length < settings.minGroup) return;
            const found = dominantTag(members, settings.minShare, settings.minGroup);
            if (!found) return;
            const keys = members
                .filter((item) => !tagsOf(item).includes(found.tag))
                .map((item) => item.key);
            if (!keys.length) return;
            proposals.push({
                tag: found.tag,
                pattern,
                reason: { kind: 'derived', have: found.have, of: found.of },
                keys,
                rank: pattern.includes('/') ? 1 : 2,
            });
        });

        /*
         * The catalogue, by host.
         *
         * No minimum group here: the evidence is the shipped file, not the
         * collection, so a single bookmark on a known site is as good a match
         * as forty. Grouping still happens by host, so the reader gets one row
         * covering a site rather than one row per bookmark. Only bare hosts
         * are looked up -- the catalogue names sites, not sections.
         *
         * And it says nothing about a host the collection has already settled.
         * Renaming through the aliases only helps when the two words are
         * related: a reader who files every github.com link under #work would
         * otherwise be offered #dev on all of them, which is the shipped
         * vocabulary splitting a tidy collection in two -- the exact thing the
         * aliases exist to prevent.
         */
        const byHost = catalogueByHost(settings.catalogue);
        if (byHost.size) {
            const settled = new Set(proposals
                .filter((proposal) => proposal.reason.kind === 'derived')
                .map((proposal) => proposal.pattern));
            const vocabulary = new Set();
            rows.forEach((item) => tagsOf(item).forEach((tag) => vocabulary.add(tag)));
            groupByPattern(rows, patternsOf).forEach((members, pattern) => {
                if (pattern.includes('/')) return;
                if (settled.has(pattern)) return;
                const entry = byHost.get(pattern);
                if (!entry) return;
                const tag = inTheirWords(entry, vocabulary);
                const keys = members
                    .filter((item) => !tagsOf(item).includes(tag))
                    .map((item) => item.key);
                if (!keys.length) return;
                proposals.push({
                    tag,
                    pattern,
                    reason: { kind: 'catalogue', subject: entry.tag },
                    keys,
                    rank: 3,
                });
            });
        }

        /*
         * The catalogue, by what the page said about itself.
         *
         * The last source, and the only one that needed a network round to
         * become possible: these are the bookmarks on sites the catalogue has
         * never heard of, so the host says nothing and the collection says
         * nothing either. What is left is the page's own vocabulary, read
         * once by the scan round and stored as a dozen words.
         *
         * Only for bookmarks the first three sources could not reach. A
         * bookmark that already has a proposal has one from better evidence --
         * something the reader wrote, or did, or a site the catalogue knows by
         * name -- and page text is the guess of last resort, not a second
         * opinion.
         *
         * Grouped by subject rather than by host, because that is the shape
         * this evidence has: the nine bookmarks that mention kubernetes are on
         * nine different sites, and a row per site would be nine rows saying
         * the same thing.
         */
        if (settings.keywords) {
            const spokenFor = new Set();
            proposals.forEach((proposal) => proposal.keys.forEach((key) => spokenFor.add(key)));
            const vocabulary = new Set();
            rows.forEach((item) => tagsOf(item).forEach((tag) => vocabulary.add(tag)));

        /*
         * A page that names the subject outright counts double.
         *
         * The catalogue's keywords are the vocabulary *around* a subject --
         * "kubelet", "etcd" -- and two of them agreeing is the floor. But a
         * page whose own words include the subject's name, or a word the
         * reader uses for it, has said what it is rather than hinted: drawio
         * writes "diagramming" in its h1, and waiting for a second word there
         * would be pedantry. So a name is worth the whole floor on its own,
         * and two hints are worth the same.
         */
            const bySubject = new Map();
            (Array.isArray(settings.catalogue) ? settings.catalogue : []).forEach((entry) => {
                const tag = String(entry?.tag || '').trim().toLowerCase();
                const words = (Array.isArray(entry?.keywords) ? entry.keywords : [])
                    .map((word) => String(word).trim().toLowerCase())
                    .filter(Boolean);
                const names = new Set([tag, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])
                    .map((alias) => String(alias).trim().toLowerCase())].filter(Boolean));
                if (tag && (words.length || names.size)) {
                    bySubject.set(tag, { entry, words: new Set(words), names });
                }
            });

            const byTag = new Map();
            rows.forEach((item) => {
                if (spokenFor.has(item.key)) return;
                const found = (settings.keywords[item.key] || [])
                    .map((word) => String(word).trim().toLowerCase())
                    .filter(Boolean);
                if (!found.length) return;

                let best = null;
                bySubject.forEach(({ entry, words, names }, tag) => {
                    const distinct = [...new Set(found)];
                    const named = distinct.filter((word) => names.has(word));
                    const hinted = distinct.filter((word) => words.has(word));
                    // One shared hint is a coincidence often enough to be
                    // worthless: "charts" is finance and it is also music. A
                    // name is not a hint, so it carries the floor by itself.
                    const score = named.length * MIN_KEYWORD_HITS + hinted.length;
                    if (score < MIN_KEYWORD_HITS) return;
                    const hits = [...new Set([...named, ...hinted])];
                    if (!best || score > best.score) best = { entry, tag, hits, score };
                });
                if (!best) return;

                const tag = inTheirWords(best.entry, vocabulary);
                if (tagsOf(item).includes(tag)) return;
                const bucket = byTag.get(tag) || { subject: best.entry.tag, keys: [], words: new Set() };
                bucket.keys.push(item.key);
                best.hits.forEach((word) => bucket.words.add(word));
                byTag.set(tag, bucket);
            });

            byTag.forEach((bucket, tag) => {
                proposals.push({
                    tag,
                    pattern: TEXT_PATTERN,
                    reason: {
                        kind: 'text',
                        subject: bucket.subject,
                        words: [...bucket.words].slice(0, 4),
                    },
                    keys: bucket.keys,
                    rank: 4,
                });
            });
        }

        /*
         * What the reader turned down stays down.
         *
         * Dropped before the per-bookmark ceiling rather than after: a
         * dismissed proposal that still consumed one of a bookmark's two slots
         * would hide the proposal the reader might have wanted, which is the
         * opposite of what refusing one is for.
         */
        const refused = new Set((settings.dismissed || [])
            .map((entry) => String(entry).trim().toLowerCase())
            .filter(Boolean));
        const kept = refused.size
            ? proposals.filter((proposal) => !refused.has(`${proposal.pattern}|${proposal.tag}`))
            : proposals;
        kept.sort((a, b) => a.rank - b.rank || b.keys.length - a.keys.length);

        // The ceiling is per bookmark, not per group: three plausible tags on
        // one link is a review panel nobody finishes reading.
        //
        // And the same tag is offered to a bookmark once, however many
        // proposals arrive at it. A rule that writes down what the collection
        // already says -- {github.com -> code} where every github.com item is
        // tagged code -- produced two rows differing only in their reason, and
        // the pair ate both of the bookmark's two slots, hiding a genuinely
        // different second suggestion. Rules come first in `proposals`, so
        // dropping the later duplicate is what makes the rule win.
        const used = new Map();
        const taken = new Map();
        const groups = [];
        kept.forEach((proposal) => {
            const keys = proposal.keys.filter((key) => !(taken.get(key) || EMPTY).has(proposal.tag)
                && (used.get(key) || 0) < settings.maxPerBookmark);
            if (!keys.length) return;
            keys.forEach((key) => {
                used.set(key, (used.get(key) || 0) + 1);
                const tags = taken.get(key) || new Set();
                tags.add(proposal.tag);
                taken.set(key, tags);
            });
            const { rank, ...group } = proposal;
            groups.push({ ...group, keys });
        });

        // Biggest first: what the reader most wants to accept in one click is
        // the group that saves the most clicks. Sort is stable, so groups of
        // equal size keep the rank order they were resolved in.
        groups.sort((a, b) => b.keys.length - a.keys.length);
        return groups;
    }

    global.TagSuggestions = { patternsFor, suggest };
})(window);
