/**
 * The bell row that offers a round of tag review.
 *
 * A collection grows faster than anyone tags it, and the panel in Config →
 * Bookmarks only helps the reader who thinks to go and look at it. This is the
 * app saying that there is something worth accepting -- in the one shape that
 * does not demand an answer: a quiet row in the notifications bell. "No" there
 * hides it until one more proposal has come up.
 *
 * It leans only on the sources that need no network: a rule you wrote, the
 * tags you already gave a site's other bookmarks, and the shipped catalogue
 * keyed on the host. A card that appeared because of page text would be
 * implicitly asking for a scan round, which is the thing the button in the
 * panel was put there to keep deliberate.
 */
(function (global) {
    'use strict';

    if (!global.NoticeCard?.define) return;

    /*
     * Ten proposals before the bell says anything.
     *
     * Below that it is not worth a card: the reader can tag three bookmarks
     * faster than they can read an offer to do so, and an offer that arrives
     * for three is one they learn to wave away before reading.
     */
    const MIN_TO_OFFER = 10;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const language = dash()?.language;
        let text = fallback;
        if (language && typeof language.t === 'function') {
            const value = language.t(key);
            if (value && value !== key) text = value;
        }
        if (!vars) return text;
        return Object.entries(vars).reduce(
            (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
            text,
        );
    }

    /*
     * The shipped catalogue, fetched once, and not before it is needed.
     *
     * Counting without it was the cheaper thing to do and the wrong one: on a
     * collection nobody has tagged yet the first two sources have nothing to
     * say, so the card would never reach its threshold and the reader would
     * never learn the feature exists. It is one cached file, asked for nine
     * seconds after load, when the dashboard has long since drawn.
     *
     * TagCatalogue holds the single copy, so a reader who has opened the
     * config panel pays nothing here, and one who sees this card first has
     * already paid for the panel.
     */
    function ensureCatalogue() {
        return global.TagCatalogue?.load?.() || Promise.resolve([]);
    }

    /*
     * What the engine proposes, from the sources that cost no round trip per
     * bookmark. The bookmarks are already in memory -- the dashboard keeps
     * them for its own grid -- so this is arithmetic.
     */
    function proposalCount() {
        const d = dash();
        if (!global.TagSuggestions?.suggest || !Array.isArray(d?.allBookmarks)) return 0;
        const items = d.allBookmarks.map((b, index) => ({
            key: `${b.pageId}::${b.url}::${index}`,
            url: b.url,
            name: b.name || '',
            title: b.previewTitle || '',
            tags: Array.isArray(b.tags) ? b.tags : [],
        }));
        try {
            return global.TagSuggestions.suggest(items, {
                rules: d.settings?.tagRules || [],
                // Whatever has landed. The card asks for the catalogue before
                // it counts, so this is empty only when the file could not be
                // read at all -- in which case the two local sources are what
                // there is, and the count is honest about that.
                catalogue: global.TagCatalogue?.now?.() || [],
                dismissed: d.settings?.dismissedTagSuggestions || [],
                // No keywords on purpose: page text is the source a scan round
                // has to be asked for, and a card that needed one would be
                // asking for it sideways.
            }).length;
        } catch (err) {
            return 0;
        }
    }

    /*
     * The category with the most bookmarks that carry no tag, when it is a pile.
     *
     * Grouped on page and category id together: the same name can exist on two
     * pages. Only the current page's categories are loaded, so a pile on
     * another page has no name to show and the card keeps its plain text.
     */
    const MIN_TOP_CATEGORY = 5;

    function topUntaggedCategory() {
        const d = dash();
        if (!Array.isArray(d?.allBookmarks)) return null;
        const groups = new Map();
        d.allBookmarks.forEach((b) => {
            const category = String(b.category ?? '').trim();
            if (!category) return;
            if (Array.isArray(b.tags) && b.tags.some(Boolean)) return;
            const key = `${b.pageId}::${category}`;
            const row = groups.get(key) || { pageId: b.pageId, category, count: 0 };
            row.count += 1;
            groups.set(key, row);
        });
        let best = null;
        groups.forEach((row) => { if (!best || row.count > best.count) best = row; });
        if (!best || best.count < MIN_TOP_CATEGORY) return null;
        if (String(best.pageId) !== String(d.currentPageId)) return null;
        const found = (d.categories || []).find((c) => String(c.id) === best.category);
        const name = String(found?.name || '').trim();
        return name ? { name, count: best.count } : null;
    }

    /*
     * The bell row: how many bookmarks could take a tag, or null when it is
     * switched off or below the threshold.
     */
    async function bellState() {
        if (dash()?.settings?.enableTagSuggestionNotice === false) return null;
        await ensureCatalogue();
        const count = proposalCount();
        if (count < MIN_TO_OFFER) return null;
        return {
            count,
            text: t('dashboard.tagSuggestionsNoticeTitle', '{count} bookmarks could take a tag', { count }),
        };
    }

    const card = global.NoticeCard.define({
        id: 'tag-suggestions-notice',
        title: () => 'Tag suggestions',
        bell: {
            kind: 'quiet',
            group: 'cleanup',
            icon: '\u{1F3F7}',
            // "No" is remembered with the count it was said at; one more
            // proposal brings the row back.
            no: 'state',
            state: bellState,
            actions: [
                {
                    label: () => t('dashboard.tagSuggestionsNoticeStart', 'Start'),
                    primary: true,
                    onClick: () => { void open(); },
                },
            ],
        },
    });

    /*
     * Start opens the panel that already exists.
     *
     * Not a modal of its own: the review panel is a tab in Config → Bookmarks
     * with the rules editor beside it and the bulk path under it, and a second
     * copy over the dashboard would be a second thing to keep in step for no
     * gain. Escape lands in config, which is where the reader now is.
     */
    async function open() {
        const d = dash();
        if (!d?.config?.openConfigView) return false;
        /*
         * The view first, the tab after.
         *
         * d.config is a lazy stub until config has loaded, so setting bmTab on
         * it before opening wrote the tab onto a placeholder and the reader
         * landed on List. Opening resolves the real instance; the tab is set on
         * that and drawn the way the strip draws it.
         */
        await d.config.openConfigView('bookmarks');
        const config = d.config.instance || d.config;
        if (config && config.bmTab !== 'tag-suggestions') {
            config.bmTab = 'tag-suggestions';
            config.render?.();
            config.restoreConfigHash?.();
        }
        return true;
    }

    /*
     * Registered with the bell as soon as the document is there; the row asks
     * bellState() for its count whenever the bell refreshes.
     */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.TagSuggestionsNotice = {
        open,
        state: bellState,
        proposalCount,
        topUntaggedCategory,
        ensureCatalogue,
        MIN_TO_OFFER,
    };
})(window);
