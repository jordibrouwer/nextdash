// Fuzzy Search Component JavaScript
class FuzzySearchComponent {
    constructor(bookmarks, openBookmarkCallback) {
        this.bookmarks = bookmarks;
        this.openBookmarkCallback = openBookmarkCallback;
    }

    updateBookmarks(bookmarks) {
        this.bookmarks = bookmarks;
    }

    /**
     * Scores a bookmark against a query.
     *
     * Tiers (higher = better):
     *   1000  exact name match
     *    700  name starts with query            ("yt" → "YT", "yt-dlp")
     *    500  a word inside the name starts with query  ("yt" → "YouTube", "My YT Page")
     *    300  query appears as a substring anywhere in the name
     *      0  no match
     *
     * Within each tier a ratio bonus (0-99) is added:
     *   (queryLength / nameLength) * 99  — shorter names rank first for the same query.
     *
     * @param {string} query  - lower-cased query
     * @param {string} name   - lower-cased bookmark name
     * @returns {number}  score ≥ 1 if matched, 0 if no match
     */
    scoreMatch(query, name) {
        if (!name || !query) return 0;

        const ratio = Math.min((query.length / name.length) * 99, 99);

        // Tier 1: exact
        if (name === query) return 1000 + ratio;

        // Tier 2: name prefix
        if (name.startsWith(query)) return 700 + ratio;

        // Tier 3: word-boundary prefix — any word inside the name starts with query
        const words = name.split(/[\s\-_./()|+,]+/);
        if (words.some(w => w.length > 0 && w.startsWith(query))) return 500 + ratio;

        // Tier 4: substring anywhere in the name
        if (name.includes(query)) return 300 + ratio;

        return 0;
    }

    /**
     * Fuzzy match: checks if query is contained in text (case-insensitive).
     * Kept for backwards compatibility with callers outside this file.
     */
    fuzzyMatch(query, text) {
        return text.toLowerCase().includes(query.toLowerCase());
    }

    /**
     * Extracts the host from a URL string for secondary-field matching.
     * @param {string} url
     * @returns {string|null}
     */
    _extractDomain(url) {
        if (!url) return null;
        const m = url.match(/^https?:\/\/([^/?#]+)/i);
        if (m) return m[1];
        // bare domain or path — return the part before the first slash
        return url.split('/')[0] || null;
    }

    /**
     * Handle fuzzy search query — returns results sorted by relevance score.
     * Also searches URL domain, tags, note and the fetched page description
     * as secondary fields (lower score).
     * @param {string} query - The search query (without the '/' prefix)
     * @returns {Array} Array of match objects sorted best-first
     */
    handleFuzzy(query, bookmarks = null) {
        if (!query.trim()) return [];

        const q = query.toLowerCase();

        const scored = [];
        for (const bookmark of (bookmarks || this.bookmarks)) {
            const name = (bookmark.name || '').toLowerCase();
            let score = this.scoreMatch(q, name);
            let meta = null;

            if (score === 0) {
                // Secondary: URL domain (scores scaled to 60-300 to stay below name matches)
                const domain = this._extractDomain((bookmark.url || '').toLowerCase());
                if (domain) {
                    const urlScore = this.scoreMatch(q, domain);
                    if (urlScore > 0) {
                        score = Math.max(1, Math.floor(urlScore * 0.3));
                        meta = bookmark.url;
                    }
                }
            }

            if (score === 0) {
                // Secondary: tags (scores scaled to 50-250)
                const tags = Array.isArray(bookmark.tags) ? bookmark.tags : [];
                for (const tag of tags) {
                    const tagScore = this.scoreMatch(q, tag.toLowerCase());
                    if (tagScore > 0) {
                        score = Math.max(1, Math.floor(tagScore * 0.25));
                        meta = `#${tag}`;
                        break;
                    }
                }
            }

            if (score === 0) {
                // Secondary: note substring (flat score of 40)
                const note = (bookmark.note || '').toLowerCase();
                if (note && note.includes(q)) {
                    score = 40;
                    meta = bookmark.note.length > 60
                        ? bookmark.note.substring(0, 60) + '…'
                        : bookmark.note;
                }
            }

            if (score === 0) {
                // Tertiary: the fetched page description, scored below the note
                // because it is the site's words rather than the user's. It is
                // fetched for every bookmark and was searched by nothing, yet it
                // often holds what you remember about a page whose title is
                // unhelpful — "Untitled", "Dashboard", "Login".
                const desc = (bookmark.previewDesc || '').toLowerCase();
                if (desc && desc.includes(q)) {
                    score = 25;
                    meta = bookmark.previewDesc.length > 60
                        ? bookmark.previewDesc.substring(0, 60) + '…'
                        : bookmark.previewDesc;
                }
            }

            if (score > 0) scored.push({ bookmark, score, meta });
        }

        scored.sort((a, b) => b.score - a.score);

        return scored.map(({ bookmark, meta }) => ({
            name: bookmark.name,
            shortcut: '',
            action: () => this.openBookmarkCallback(bookmark),
            type: 'fuzzy',
            bookmark,
            query,
            meta
        }));
    }

    _escHtml(str) {
        return window.NextDashHtml.escapeHtml(str);
    }

    /**
     * Highlights the best matching substring in fuzzy search results.
     * Prefers highlighting the earliest word-boundary match over a random substring.
     * @param {string} name  - The bookmark name (original casing)
     * @param {string} query - The fuzzy search query
     * @returns {string} HTML string with highlighted match
     */
    highlightFuzzyMatch(name, query) {
        if (!query) return this._escHtml(name);
        const lowerName = name.toLowerCase();
        const lowerQuery = query.toLowerCase();

        // Prefer highlighting from a word boundary
        const wordBoundaryIdx = lowerName.search(
            new RegExp(`(?:^|[\\s\\-_./()|+,])${lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
        );
        const matchIdx = wordBoundaryIdx >= 0
            ? lowerName.indexOf(lowerQuery, wordBoundaryIdx)
            : lowerName.indexOf(lowerQuery);

        if (matchIdx === -1) return this._escHtml(name);
        const before = name.substring(0, matchIdx);
        const highlighted = name.substring(matchIdx, matchIdx + query.length);
        const after = name.substring(matchIdx + query.length);
        return `${this._escHtml(before)}<span class="fuzzy-highlight">${this._escHtml(highlighted)}</span>${this._escHtml(after)}`;
    }
}

// Export for use in other modules
window.FuzzySearchComponent = FuzzySearchComponent;
