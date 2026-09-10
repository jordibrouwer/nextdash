/**
 * The corner card that offers a round of tag review.
 *
 * A collection grows faster than anyone tags it, and the panel in Config →
 * Bookmarks only helps the reader who thinks to go and look at it. This is the
 * app saying, now and then, that there is something worth accepting -- in the
 * one shape that does not demand an answer: a card in the corner with three
 * ways out, none of which is "deal with this now".
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
     * Ten proposals before the corner says anything.
     *
     * Below that it is not worth a card: the reader can tag three bookmarks
     * faster than they can read an offer to do so, and an offer that arrives
     * for three is one they learn to wave away before reading.
     */
    const MIN_TO_OFFER = 10;

    /*
     * Late enough that the dashboard is the dashboard first.
     *
     * The same nine seconds the link-review offer waits: long enough that the
     * page has settled and the reader has looked at what they came for, short
     * enough to still belong to this visit.
     */
    const SHOW_DELAY_MS = 9000;

    const DONE_KEY = 'tagSuggestionNoticeDoneOn';
    const SNOOZE_KEY = 'tagSuggestionNoticeSnoozeUntil';
    /*
     * How many proposals stood the last time the reader answered.
     *
     * Without it, accepting one group of a pile leaves the rest above the
     * threshold and the card comes straight back -- which reads as nagging
     * rather than as offering. It asks again once ten *new* ones have
     * accumulated on top of whatever was left.
     */
    const SEEN_KEY = 'tagSuggestionNoticeSeenCount';

    let lastCount = 0;

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

    function todayKey() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${now.getFullYear()}-${month}-${day}`;
    }

    function read(key) {
        try {
            return global.localStorage?.getItem(key);
        } catch (err) {
            // A private window, or site data switched off. Asking again is the
            // smaller failure of the two.
            return null;
        }
    }

    function write(key, value) {
        try {
            global.localStorage?.setItem(key, value);
        } catch (err) {
            // Same: the offer is not worth breaking a page over.
        }
    }

    function isDoneToday() {
        return read(DONE_KEY) === todayKey();
    }

    function markDoneToday() {
        write(DONE_KEY, todayKey());
        write(SEEN_KEY, String(lastCount));
    }

    function isSnoozed() {
        const until = Number(read(SNOOZE_KEY));
        return Number.isFinite(until) && until > Date.now();
    }

    function remindInThirtyDays() {
        write(SNOOZE_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
        write(SEEN_KEY, String(lastCount));
    }

    /** What was standing the last time this was answered. */
    function answeredAt() {
        const seen = Number(read(SEEN_KEY));
        return Number.isFinite(seen) && seen > 0 ? seen : 0;
    }

    let catalogue = null;
    let cataloguePromise = null;

    /*
     * The shipped catalogue, fetched once, and not before it is needed.
     *
     * Counting without it was the cheaper thing to do and the wrong one: on a
     * collection nobody has tagged yet the first two sources have nothing to
     * say, so the card would never reach its threshold and the reader would
     * never learn the feature exists. It is one cached file, asked for nine
     * seconds after load, when the dashboard has long since drawn.
     *
     * The config panel keeps its own copy; whichever has one is used, so a
     * reader who has opened the tab pays nothing here.
     */
    function ensureCatalogue() {
        const config = dash()?.config?.instance || dash()?.config;
        if (config?._tagCatalogue?.length) return Promise.resolve(config._tagCatalogue);
        if (catalogue?.length) return Promise.resolve(catalogue);
        if (cataloguePromise) return cataloguePromise;
        cataloguePromise = fetch('/static/data/tag-patterns.json', { cache: 'no-cache' })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                catalogue = Array.isArray(data?.tags) ? data.tags : [];
                return catalogue;
            })
            .catch(() => {
                // A missing file costs the catalogue's own proposals and
                // nothing else, the same as it does in the panel.
                catalogue = [];
                return catalogue;
            });
        return cataloguePromise;
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
            tags: Array.isArray(b.tags) ? b.tags : [],
        }));
        const config = d.config?.instance || d.config;
        try {
            return global.TagSuggestions.suggest(items, {
                rules: d.settings?.tagRules || [],
                // Whichever actually holds something: config sets its own copy
                // to [] when the fetch fails or has not run, and an empty
                // array is truthy -- so `||` handed the count a catalogue of
                // nothing and the card never reached its threshold.
                catalogue: (config?._tagCatalogue?.length ? config._tagCatalogue : catalogue) || [],
                dismissed: d.settings?.dismissedTagSuggestions || [],
                // No keywords on purpose: page text is the source a scan round
                // has to be asked for, and a card that needed one would be
                // asking for it sideways.
            }).length;
        } catch (err) {
            return 0;
        }
    }

    const card = global.NoticeCard.define({
        id: 'tag-suggestions-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.tagSuggestionsNoticeTitle', '{count} bookmarks could take a tag',
            { count: lastCount }),
        body: () => t('dashboard.tagSuggestionsNoticeBody',
            'Worked out from the tags you already use and the sites nextDash knows. Nothing is tagged until you say so.'),
        dismissLabel: () => t('dashboard.tagSuggestionsNoticeLater', 'Not today'),
        dismissName: 'later',
        canShow: async () => {
            if (dash()?.settings?.enableTagSuggestionNotice === false) return false;
            if (isDoneToday()) return false;
            if (isSnoozed()) return false;
            await ensureCatalogue();
            const count = proposalCount();
            // Ten *new* ones since the last answer, so accepting part of a pile
            // does not bring the card straight back for the remainder.
            if (count < MIN_TO_OFFER || count < answeredAt() + MIN_TO_OFFER) return false;
            lastCount = count;
            return true;
        },
        // The × and "Not today" mean the same thing: not now, ask tomorrow.
        onDismiss: markDoneToday,
        actionAttr: 'data-tag-suggestions-notice-action',
        actions: [
            {
                name: 'start',
                label: () => t('dashboard.tagSuggestionsNoticeStart', 'Start'),
                primary: true,
                onClick: (handle) => {
                    handle.close();
                    markDoneToday();
                    void open();
                },
            },
            {
                name: 'later',
                label: () => t('dashboard.tagSuggestionsNoticeLater', 'Not today'),
                onClick: (handle) => { markDoneToday(); handle.close(); },
            },
            {
                name: 'remind',
                quiet: true,
                label: () => t('dashboard.tagSuggestionsNoticeRemindLater', 'Remind me in 30 days'),
                onClick: (handle) => { remindInThirtyDays(); handle.close(); },
            },
        ],
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
     * Started the way the other cards are: on its own, once the document is
     * there. define() builds the card and waits out its delay; nothing shows
     * until canShow says so.
     */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.TagSuggestionsNotice = {
        ...card,
        open,
        proposalCount,
        ensureCatalogue,
        // What has been fetched so far, for the dashboard's own tag popover:
        // it draws synchronously and cannot wait for a file.
        catalogueNow: () => catalogue || [],
        MIN_TO_OFFER,
    };
})(window);
