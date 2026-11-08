/**
 * What the keys-and-help sheet says about the page you are on.
 *
 * The cheat sheet lists keys; this says where you are and what to do first.
 * One entry per context (the same ids the cheat-sheet registry leads with:
 * bookmarks, library, tag-view, inbox, inbox-triage, docker, glances, config,
 * and a few Config pages as `config:<section>`): a title, one sentence on what
 * the page is, the mode the keys are in, and the first steps with a key each.
 *
 * A step may carry a `try`, and only a safe one: a key that moves, opens a
 * view, opens a palette mode or switches an aid on or off. A key that changes
 * a bookmark never has one; it is explained, and pressed for real on the page.
 * The keys named here are checked against the registry by a spec, so the
 * sheet cannot promise a key the app does not have.
 *
 * English text with a locale lookup (`pageHelp.<id>.*`); a locale without the
 * key shows the English.
 */
(function (global) {
    'use strict';

    const k = (key, extra = {}) => ({ key, ...extra });

    /** try: { key, shift?, ctrl?, code? } sends that key; { tour }, { config } open those. */
    const HELP = {
        bookmarks: {
            title: 'Your dashboard',
            intro: 'Your bookmarks, in categories. Type to find one, or move a cursor to act on it.',
            mode: 'search',
            tour: 'dashboardTutorialV3',
            settings: 'behavior',
            steps: [
                { keys: '↓', text: 'Start a cursor on a bookmark', explain: 'With the cursor on a row the plain letters act on it: e edit, m move, t tags, p pin. Esc goes back to searching.', try: k('ArrowDown') },
                { keys: 'Type', text: 'Find a bookmark by its shortcut or name', explain: 'With nothing selected your letters search. Enter opens the best match.' },
                { keys: ':', text: 'Run any command', explain: 'The palette holds every action that has no key of its own. Type a few letters of what you want.', try: k(':') },
                { keys: 'Shift+B', text: 'Open the Bookmarks view', explain: 'Every bookmark across your pages in one list, to search, filter and clean up.', try: k('B', { shift: true, code: 'KeyB' }) },
                { keys: 'Shift+N', text: 'Open the notifications bell', explain: 'What needs you waits there: alerts, updates, questions and two tips a day. The same key closes it.', try: k('N', { shift: true, code: 'KeyN' }) },
                { keys: 'Shift+H', text: 'Hide or show the key legend', explain: 'The legend under the grid lists the keys that work right now.', try: k('H', { shift: true, code: 'KeyH' }) },
                { keys: 'w', text: 'Watch the feed of the bookmark under the cursor', explain: 'Pick which feeds of the site to follow and how often to check. Its news then shows on the bookmark.' },
                { keys: 'Shift+W', text: 'Read the news of the feeds you watch', explain: 'Every watched site in one paper, with read and unread per item. With no feed watched yet it says so, and points to help.' },
            ],
        },
        library: {
            title: 'The Bookmarks view',
            intro: 'Every bookmark across your pages, in one list. Search, filter, edit or clean up.',
            mode: 'browse',
            tour: 'bookmarksTutorialV1',
            settings: 'bookmarks',
            steps: [
                { keys: 'j / k', text: 'Move through the rows', explain: 'The first press puts the cursor on a row. The strip beside the page name then shows the letters for that row.', try: k('j') },
                { keys: 'e', text: 'Edit the bookmark under the cursor', explain: 'Opens the details panel on the bookmark. Esc closes it again.' },
                { keys: 't', text: 'Add or change its tags', explain: 'Tags are how you find things later: # in the palette searches them.' },
                { keys: 'x', text: 'Tick rows to act on several at once', explain: 'Shift+X ticks a range, Ctrl/Cmd+A ticks all. Then m moves them, d deletes them.' },
                { keys: '/', text: 'Search this list', explain: 'Filters the list by name, address and tags as you type.', try: k('/') },
            ],
        },
        'tag-view': {
            title: 'Tags',
            intro: 'Bookmarks grouped by their tags. Pick a tag in the rail, then work through the list.',
            mode: 'browse',
            settings: 'bookmarks',
            steps: [
                { keys: 'j / k', text: 'Move through the rows', explain: 'The same keys as every list: the first press puts the cursor on a row.', try: k('j') },
                { keys: 'p', text: 'Pin the bookmark under the cursor', explain: 'Pinned bookmarks come first.' },
                { keys: 'x', text: 'Tick rows to act on several', explain: 'Then m moves them, d deletes them.' },
                { keys: '/', text: 'Search within these bookmarks', explain: 'Narrows the list to what matches as you type.', try: k('/') },
            ],
        },
        inbox: {
            title: 'The Inbox',
            intro: 'Links you saved but did not sort yet. Go through them with the keyboard: keep, tag or drop each one.',
            mode: 'browse',
            tour: 'inboxTutorialV3',
            settings: 'inbox',
            steps: [
                { keys: 'j / k', text: 'Move through the rows', explain: 'The first press puts the cursor on a link.', try: k('j') },
                { keys: 'm', text: 'Keep the link in a category', explain: 'Moves it out of the Inbox into the category you pick.' },
                { keys: 't', text: 'Add tags', explain: 'Tags make it findable later; # in the palette searches them.' },
                { keys: 'd', text: 'Delete the link', explain: 'You get an undo for a moment.' },
                { keys: 'f', text: 'Triage one link at a time', explain: 'A focused view for the whole pile: keep, tag, snooze or drop each in turn.' },
            ],
        },
        'inbox-triage': {
            title: 'Triage',
            intro: 'One link at a time: keep it, tag it, snooze it or let it go.',
            mode: 'browse',
            tour: 'inboxTutorialV3',
            settings: 'inbox',
            steps: [
                { keys: 'm', text: 'Keep it in a category', explain: 'Then the next link comes up.' },
                { keys: 'n', text: 'Add a note', explain: 'A note stays with the link.' },
                { keys: 'z', text: 'Snooze it', explain: 'It comes back when you said it should.' },
                { keys: 'd', text: 'Delete it', explain: 'With an undo for a moment.' },
            ],
        },
        docker: {
            title: 'Containers',
            intro: 'Your Docker containers. Start, stop, read logs or update them from the keyboard.',
            mode: 'browse',
            tour: 'containersTutorialV3',
            settings: 'containers',
            steps: [
                { keys: 'j / k', text: 'Move through the containers', explain: 'The first press puts the cursor on one.', try: k('j') },
                { keys: 'l', text: 'Read the logs', explain: 'Opens the logs of the container under the cursor.' },
                { keys: 's', text: 'Start or stop it', explain: 'Only where control is switched on for this install.' },
                { keys: '[ / ]', text: 'Switch between containers and disk', explain: 'The same keys step through tabs everywhere.' },
            ],
        },
        glances: {
            title: 'Glances',
            intro: 'Live numbers from the host you watch with Glances.',
            mode: 'browse',
            tour: 'glancesTutorialV1',
            settings: 'glances',
            steps: [
                { keys: 'o p c d n', text: 'Jump to a section', explain: 'Overview, processes, containers, disks, network; more on the cheat sheet.' },
                { keys: '[ / ]', text: 'Step through the sections', explain: 'The same keys step through tabs everywhere.', try: k(']') },
                { keys: 'r', text: 'Read the host now', explain: 'Fetches fresh numbers instead of waiting for the next refresh.' },
                { keys: '/', text: 'Search the processes', explain: 'Filters the process list as you type. It needs the Processes or Containers section: press p first.' },
            ],
        },
        config: {
            title: 'Config',
            intro: 'Every setting in nextDash. A page is either a form or a list of rows.',
            mode: 'browse',
            settings: 'help',
            steps: [
                { keys: 'Ctrl/Cmd+Shift+K', text: 'Find a setting', explain: 'Type what you are looking for; it jumps to the page and the field.', try: k('K', { ctrl: true, shift: true, code: 'KeyK' }) },
                { keys: 'j / k', text: 'Previous and next page, or rows on a list page', explain: 'On a list page (Structure, Finders, Widgets, backups) j and k move through the rows.', try: k('j') },
                { keys: 'Alt+↑ / ↓', text: 'Step between pages from anywhere', explain: 'Works on list pages too, where j and k belong to the rows.' },
                { keys: '[ / ]', text: 'Previous and next tab of this page', explain: 'The same keys step through tabs everywhere.', try: k(']') },
            ],
        },
        bell: {
            title: 'The notifications bell',
            intro: 'What needs you waits here: alerts, updates, questions and two tips a day. Nothing pops up on the dashboard.',
            mode: 'bell',
            settings: 'behavior',
            steps: [
                { keys: 'Shift+N', text: 'Open or close the bell', explain: 'From anywhere on the dashboard; the same key closes it, and so does Esc.' },
                { keys: 'Tab', text: 'Move between the rows and their buttons', explain: 'A tip has Mark read, every other row has No, and many have a button of their own. Enter or Space presses the one you are on.' },
                { keys: 'Esc', text: 'Close the bell', explain: 'Closes it and puts focus back on the bell button.' },
            ],
        },
        'config:feed-watch': {
            title: 'Config → Watch feeds',
            intro: 'The feeds you follow, with the newest item of each. Mute, pause or stop one, or set a word filter.',
            mode: 'browse',
            settings: 'feed-watch',
            steps: [
                { keys: 'j / k', text: 'Move through the feeds', explain: 'The first press puts the cursor on a feed.', try: k('j') },
                { keys: 'Enter', text: 'Open the details of a feed', explain: 'Its interval, word filter and newest items.' },
                { keys: 'm', text: 'Mute it', explain: 'Keeps watching but stops counting its news as unread. Press again to unmute.' },
                { keys: 'p', text: 'Pause it', explain: 'Stops checking until you press p again.' },
                { keys: 'd', text: 'Stop watching it', explain: 'Removes the feed from this list. The bookmark stays.' },
            ],
        },
        'config:structure': {
            title: 'Config → Structure',
            intro: 'Your pages, categories, tags and collections. Rows you can reorder, rename and delete.',
            mode: 'browse',
            settings: 'structure',
            steps: [
                { keys: 'j / k', text: 'Move through the rows', explain: 'The first press puts the cursor on a row.', try: k('j') },
                { keys: 'e', text: 'Edit the row', explain: 'Goes to its first field.' },
                { keys: 'y', text: 'Duplicate it', explain: 'Copies a page or category, with or without its bookmarks.' },
                { keys: 'd', text: 'Delete it', explain: 'Asks first, like the Delete button does.' },
                { keys: 'u / n', text: 'Move a page up or down', explain: 'Changes the order of the page tabs.' },
            ],
        },
        'config:widgets': {
            title: 'Config → Widgets',
            intro: 'The widgets on a page: switch them on and off, rename them, open their settings.',
            mode: 'browse',
            settings: 'widgets',
            steps: [
                { keys: 'j / k', text: 'Move through the widgets', explain: 'The first press puts the cursor on a row.', try: k('j') },
                { keys: 's', text: 'Open its settings', explain: 'The same panel the Settings button opens.' },
                { keys: 'h', text: 'Show or hide it', explain: 'Flips the Shown box.' },
                { keys: 'x', text: 'Tick it for a bulk action', explain: 'Then the bar above the list moves or removes the ticked ones.' },
            ],
        },
    };

    const MODES = [
        { keys: '>', text: 'Search', explain: 'Type a shortcut or a name; Enter opens the best match.', key: k('>') },
        { keys: ':', text: 'Commands', explain: 'Every action without a key of its own. Try :dark.', key: k(':') },
        { keys: '!', text: 'Finders', explain: 'Search a site: ! g followed by your query.', key: k('!') },
        { keys: '#', text: 'Tags', explain: 'Find by tag. Join tags with AND and OR: #docker AND linux. #tag and tag are the same.', key: k('#') },
        { keys: '*', text: 'Recent', explain: 'What you opened last.', key: k('*') },
        { keys: '=', text: 'Assistant', explain: 'Ask a question about your dashboard.', key: k('=') },
        { keys: '@', text: 'All pages', explain: 'Search across every page at once.', key: k('@') },
        { keys: '?', text: 'This sheet', explain: 'Keys and help, always for the page you are on.' },
    ];

    /** Every guided tour, the same list as Config → Help → Tours (DashboardConfig.GUIDED_TOURS); the Learn tab offers all of them. */
    const TOURS = [
        { id: 'changesTourV1', labelKey: 'config.tourChanges', label: 'What has changed' },
        { id: 'quickStart', labelKey: 'config.tourWelcome', label: 'First steps' },
        { id: 'dashboardTutorialV3', labelKey: 'config.tourDashboard', label: 'The dashboard' },
        { id: 'keyboardTutorialV1', labelKey: 'config.tourKeyboard', label: 'The keyboard' },
        { id: 'inboxTutorialV3', labelKey: 'config.tourInbox', label: 'Inbox' },
        { id: 'bookmarksTutorialV1', labelKey: 'config.tourBookmarks', label: 'Bookmarks view' },
        { id: 'containersTutorialV3', labelKey: 'config.tourContainers', label: 'Containers' },
        { id: 'glancesTutorialV1', labelKey: 'config.tourGlances', label: 'Glances' },
        { id: 'widgetsTutorialV2', labelKey: 'config.tourWidgets', label: 'Widgets' },
        { id: 'monitoringTutorialV1', labelKey: 'config.tourMonitoring', label: 'Monitoring' },
        { id: 'unraidTutorialV1', labelKey: 'config.tourUnraid', label: 'Unraid' },
        { id: 'assistantTutorialV1', labelKey: 'config.tourAssistant', label: 'AI Assistant' },
    ];

    /**
     * The Config → Help panels each page reads from: the sheet quotes the first
     * paragraph of the panel (from the same locale string Help renders) and
     * links to it, so there is one text and nothing to keep in step.
     * tab = the Help tab, title/body = the panel's string keys.
     */
    const P = (tab, name) => ({ tab, title: `config.help${name}Title`, body: `config.help${name}Body` });
    const LINKS = {
        // The bell first: Keys for this page from its Help panel must find it, not the dashboard.
        bell: [P('start', 'Bell')],
        bookmarks: [P('search', 'Keyboard'), P('search', 'Search'), P('start', 'Bell'), P('monitoring', 'Fresh')],
        library: [P('bookmarks', 'BmKeys'), P('bookmarks', 'Library')],
        'tag-view': [P('organizing', 'Tags')],
        inbox: [P('inbox', 'InboxWork'), P('inbox', 'InboxTriage')],
        'inbox-triage': [P('inbox', 'InboxTriage')],
        docker: [P('containers', 'Containers')],
        glances: [P('glances', 'Glances')],
        config: [P('search', 'ConfigKeyboard')],
        'config:feed-watch': [P('monitoring', 'Fresh')],
        'config:structure': [P('organizing', 'Workspace')],
        'config:widgets': [P('widgets', 'Widgets')],
    };

    /** A step that has a longer answer in Help: its keys -> the index of the panel in LINKS. */
    const MORE = {
        bookmarks: { ':': 1, 'Shift+B': 0, 'Shift+H': 0, 'Shift+N': 2, w: 3, 'Shift+W': 3 },
        bell: { 'Shift+N': 0 },
        library: { 'j / k': 0, x: 0 },
        inbox: { m: 0, f: 1 },
        docker: { l: 0 },
        glances: { 'o p c d n': 0 },
        config: { 'Ctrl/Cmd+Shift+K': 0, 'j / k': 0 },
        'config:feed-watch': { 'j / k': 0 },
        'config:structure': { 'j / k': 0 },
        'config:widgets': { 'j / k': 0 },
    };

    /** Tips (the Config → Help tips) that fit a page; one shows at a time. */
    const TIPS = {
        bell: ['tipEverydayBell'],
        bookmarks: ['tipEverydayGridLetters', 'tipEverydayLegend', 'tipEverydayStrip', 'tipEverydayModes', 'tipFindHashTags'],
        library: ['tipEditWorkbench', 'tipMaintWorkThrough', 'tipFindHashTags'],
        'tag-view': ['tipFindTagView', 'tipFindHashTags'],
        inbox: ['tipEditKeep', 'tipEditTriage'],
        'inbox-triage': ['tipEditTriage'],
        docker: ['tipDataContainers', 'tipHostLogs'],
        glances: ['tipGlancesKeys'],
        config: ['tipConfigKeyboard', 'tipConfigRowLetters'],
        'config:feed-watch': ['tipWatchFeedKey', 'tipWatchExpiry'],
        'config:structure': ['tipConfigRowLetters'],
        'config:widgets': ['tipConfigRowLetters'],
    };

    /** The id Help gives a panel, the same rule as DashboardConfig.helpPanelId. */
    function panelId(titleKey) {
        return String(titleKey).replace(/^config\.help/, '').replace(/Title$/, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() || 'panel';
    }

    /** The markup the sheet lets through from a help text: code, keys, strong and em. */
    function safeHtml(html) {
        const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
        const walk = (node) => {
            let out = '';
            node.childNodes.forEach((child) => {
                if (child.nodeType === 3) { out += child.textContent.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); return; }
                if (child.nodeType !== 1) return;
                const tag = child.tagName.toLowerCase();
                const inner = walk(child);
                out += ['code', 'kbd', 'strong', 'em'].includes(tag) ? `<${tag}>${inner}</${tag}>` : inner;
            });
            return out;
        };
        return walk(doc.body.firstChild);
    }

    function plainText(html) {
        const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
        return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function firstParagraph(html) {
        const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
        const p = doc.body.querySelector('p');
        return p ? p.innerHTML : html;
    }

    /** The Help panels a page reads from, with the excerpt, the whole text as plain words and the address. */
    function helpCards(contextId, dash) {
        const id = idFor(contextId, dash);
        return (LINKS[id] || []).map((link) => {
            const title = t(dash, link.title, '');
            const body = t(dash, link.body, '');
            if (!title || !body) return null;
            const excerpt = safeHtml(firstParagraph(body));
            return {
                tab: link.tab,
                panel: panelId(link.title),
                title,
                excerptPlain: plainText(firstParagraph(body)),
                excerpt: excerpt.length > 520 ? `${excerpt.slice(0, excerpt.lastIndexOf(' ', 500))}…` : excerpt,
                plain: plainText(body),
                hash: `#config/help/${link.tab}/${panelId(link.title)}`,
            };
        }).filter(Boolean);
    }

    /** The pages a Help panel belongs to, for the way back from Help to the sheet. */
    function contextsForPanel(titleKey) {
        return Object.entries(LINKS).filter(([, links]) => links.some((l) => l.title === titleKey)).map(([id]) => id);
    }

    /** One tip for the page: the first not shown yet, then they come round again. */
    function tipFor(contextId, dash) {
        const ids = TIPS[idFor(contextId, dash)] || [];
        if (!ids.length) return null;
        const KEY = 'nextdash:sheet-tips-shown';
        let shown = [];
        try { shown = JSON.parse(global.localStorage?.getItem(KEY) || '[]') || []; } catch (_e) { shown = []; }
        // Only a tip that has its text counts: a locale without it is skipped, not used up.
        const withText = ids.filter((tipId) => t(dash, `config.${tipId}`, ''));
        if (!withText.length) return null;
        const pick = withText.find((tipId) => !shown.includes(tipId)) || withText[Date.now() % withText.length];
        try {
            if (!shown.includes(pick)) global.localStorage?.setItem(KEY, JSON.stringify([...shown, pick].slice(-60)));
        } catch (_e) { /* private mode: it just repeats */ }
        return { id: pick, html: safeHtml(t(dash, `config.${pick}`, '')) };
    }

    /** Read more: Config → Help, on the panel. The sheet closes first. */
    function openHelp(dash, hash) {
        if (!hash) return;
        global.AppModal?.hide?.();
        setTimeout(() => {
            // The same address sets nothing off: say it changed so the page goes there anyway.
            if (global.location.hash === hash) {
                global.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: global.location.href, newURL: global.location.href }));
            } else {
                global.location.hash = hash;
            }
        }, 160);
    }

    function t(dash, key, fallback) {
        const lang = dash?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function idFor(contextId, dash) {
        if (contextId === 'config') {
            const section = dash?.config?.section;
            if (section && HELP[`config:${section}`]) return `config:${section}`;
        }
        return HELP[contextId] ? contextId : 'bookmarks';
    }

    /** The page's help with the locale applied. */
    function forContext(contextId, dash) {
        return resolve(idFor(contextId, dash), dash);
    }

    function resolve(id, dash) {
        const h = HELP[id];
        const p = `pageHelp.${id}`;
        return {
            id,
            title: t(dash, `${p}.title`, h.title),
            intro: t(dash, `${p}.intro`, h.intro),
            mode: h.mode,
            tour: h.tour || null,
            settings: h.settings || null,
            steps: h.steps.map((s, i) => ({
                keys: s.keys,
                description: t(dash, `${p}.step${i + 1}`, s.text),
                explain: t(dash, `${p}.step${i + 1}Explain`, s.explain || ''),
                try: s.try || null,
                more: MORE[id]?.[s.keys] ?? null,
                moreHash: (() => { const n = MORE[id]?.[s.keys]; const l = n == null ? null : LINKS[id]?.[n]; return l ? `#config/help/${l.tab}/${panelId(l.title)}` : null; })(),
            })),
        };
    }

    /** Keys that only reach their mode from the dashboard grid: elsewhere a Try it would do nothing. */
    const GRID_ONLY = new Set(['#']);

    function modes(dash) {
        const onGrid = Boolean(dash?.isBookmarksView?.()) && !dash?.config?.isActiveView?.();
        return MODES.map((m, i) => ({
            keys: m.keys,
            description: t(dash, `pageHelp.modes.m${i + 1}`, m.text),
            explain: t(dash, `pageHelp.modes.m${i + 1}Explain`, m.explain),
            try: m.key && (onGrid || !GRID_ONLY.has(m.keys)) ? m.key : null,
        }));
    }

    /** Send one safe key to the page, as a press would. */
    function sendKey(spec) {
        const code = spec.code || (spec.key.length === 1 && /[a-z]/i.test(spec.key) ? `Key${spec.key.toUpperCase()}` : '');
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: spec.key, code, shiftKey: Boolean(spec.shift), ctrlKey: Boolean(spec.ctrl), metaKey: false, altKey: false,
            bubbles: true, cancelable: true,
        }));
    }

    /**
     * Do a step's `try` on the page behind the sheet. Only keys that move,
     * open or switch an aid; the sheet closes first so the key lands there.
     */
    function run(dash, spec) {
        if (!spec) return false;
        if (spec.tour) { void dash?.config?.replayTour?.(spec.tour); return true; }
        if (spec.config) { void dash?.config?.openConfigView?.(spec.config); return true; }
        if (spec.key) { sendKey(spec); return true; }
        return false;
    }

    global.KeyboardPageHelp = { HELP, MODES, TOURS, LINKS, TIPS, panelId, helpCards, contextsForPanel, tipFor, openHelp, safeHtml, forContext, byId: resolve, modes, run, sendKey, idFor, t };
})(window);
