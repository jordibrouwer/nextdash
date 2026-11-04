/**
 * Occasional tips.
 *
 * Two tips a day wait in the notifications bell (group Tips) until they are
 * read. The tips themselves are not a new list: they are the same translated
 * strings Config → Help renders, read from window.ConfigHelpTips, so the two
 * can never drift apart.
 *
 * Each calendar day brings two new tips (two slots), whether or not
 * yesterday's were read: an unread tip simply leaves the bell. A tip that is
 * read leaves its slot empty until the next day. Tips are drawn at random, but
 * those never offered before to this person come first; only when fewer than
 * two of those remain are the slots filled from tips offered before (not
 * yesterday's, if it can be avoided). The day and its two tips, and the list
 * of tips ever offered, are remembered in localStorage, so a reload shows the
 * same two rather than drawing others.
 *
 * Deliberately conservative: none during onboarding, and a single toggle in
 * Config → General (the rows are then simply absent).
 */
(function initKeyboardTip(global) {
    'use strict';

    const CURRENT_KEY = 'nextdash-keyboard-tip-current';
    const OFFERED_KEY = 'nextdash-keyboard-tips-offered';
    const SLOTS = 2;
    const ID_PREFIX = 'keyboard-tip:';
    const FIRST_TICK_MS = 4000;
    const TICK_EVERY_MS = 5 * 60 * 1000;

    // The tips waiting in the bell: tip id -> its bell handle.
    const shown = new Map();

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const full = `dashboard.${key}`;
        const value = lang.t(full);
        return value && value !== full ? value : fallback;
    }

    /** Tip ids in catalog order, flattened out of the Config → Help groups. */
    function allTipIds() {
        const groups = global.ConfigHelpTips?.TIP_GROUPS;
        if (!Array.isArray(groups)) return [];
        return groups.flatMap((g) => (Array.isArray(g.tips) ? g.tips : []));
    }

    function tipText(id) {
        const lang = dash()?.language;
        if (!lang?.t) return '';
        const full = `config.${id}`;
        const value = lang.t(full);
        return value && value !== full ? value : '';
    }

    /** The tip as plain text: the bell draws text, and the strings carry <code>. */
    function plainText(html) {
        const holder = document.createElement('template');
        holder.innerHTML = html;
        return holder.content.textContent.trim();
    }

    function bellIdOf(tipId) {
        return `${ID_PREFIX}${tipId}`;
    }

    /**
     * Whether this tip was read today. A tip offered again after a while is the
     * same bell row, told apart by the day it carries as its id, so only a read
     * mark for today counts.
     */
    function wasReadToday(tipId) {
        const read = global.DiscoverabilityState?.getBellRecord?.(bellIdOf(tipId))?.read;
        return Boolean(read && Array.isArray(read.ids) && read.ids.includes(today()));
    }

    /** Today as a local date: new tips come once per calendar day. */
    function today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /**
     * { day, ids }: the day the tips were offered and the (up to two) tip ids.
     * The older shapes still read: { id, day } is one tip, and a bare id is a
     * tip from an earlier day, so it is replaced by today's.
     */
    function remembered() {
        try {
            const raw = global.localStorage?.getItem(CURRENT_KEY);
            if (!raw) return { day: '', ids: [] };
            if (raw.startsWith('{')) {
                const v = JSON.parse(raw);
                const ids = Array.isArray(v?.ids) ? v.ids : (v?.id ? [v.id] : []);
                return { day: String(v?.day || ''), ids: ids.filter((i) => typeof i === 'string').slice(0, SLOTS) };
            }
            return { day: '', ids: [raw] };
        } catch {
            return { day: '', ids: [] };
        }
    }

    function remember(ids, day) {
        try {
            global.localStorage?.setItem(CURRENT_KEY, JSON.stringify({ day: day || '', ids: ids || [] }));
        } catch { /* a reload may then draw other tips: harmless */ }
    }

    /** Tips put in the bell at least once, ever. */
    function offeredBefore() {
        try {
            const v = JSON.parse(global.localStorage?.getItem(OFFERED_KEY) || '[]');
            return new Set(Array.isArray(v) ? v : []);
        } catch {
            return new Set();
        }
    }

    function rememberOffered(ids) {
        const all = offeredBefore();
        ids.forEach((id) => all.add(id));
        try {
            global.localStorage?.setItem(OFFERED_KEY, JSON.stringify([...all]));
        } catch { /* the tip may then come round early: harmless */ }
    }

    function shuffled(list) {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    /**
     * Two tips for a new day, at random: never offered ones first, then ones
     * offered before (not those of `avoid`, unless nothing else is left).
     * Never the same tip twice.
     */
    function pickTips(avoid = []) {
        const written = allTipIds().filter((id) => tipText(id));
        const offered = offeredBefore();
        const picked = shuffled(written.filter((id) => !offered.has(id))).slice(0, SLOTS);
        if (picked.length < SLOTS) {
            const rest = shuffled(written.filter((id) => offered.has(id) && !picked.includes(id)));
            const fresh = rest.filter((id) => !avoid.includes(id));
            const stale = rest.filter((id) => avoid.includes(id));
            picked.push(...fresh.concat(stale).slice(0, SLOTS - picked.length));
        }
        return picked;
    }

    /** Whether a new tip may be offered at all (not whether one is waiting). */
    function shouldShow() {
        const d = dash();
        if (!d) return false;
        if (d.settings?.enableSessionTips === false) return false;
        // No tips in the public demo: the bar and the tour already speak.
        if (global.DemoLock?.on) return false;
        // Rotating tips are not for phones, as before.
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        // One new tip per calendar day, read or not: the day is kept by tick().
        return true;
    }

    /** The tip is read: count it as shown, the way the toast did, and let go of it. */
    function settle(tipId) {
        global.DiscoverabilityState?.markTipSeen?.(tipId);
        global.DiscoverabilityState?.noteTipShown?.();
        global.nextdashTrack?.('tip:shown', { tip: tipId });
        release(tipId);
    }

    function release(tipId) {
        shown.get(tipId)?.unregister();
        shown.delete(tipId);
    }

    /*
     * Where a tip's button leads: the place the tip is about. CHEAT is only for
     * tips about the list of keys itself; NONE (or a tip not named here) means
     * no real place exists, so the row has no button but the bell's Mark read.
     * One line per tip, grouped by what it is about:
     *   config  a Config section, or section/tab (the deepest address that routes)
     *   view    a full view: inbox, library, unsorted, tags, docker, glances
     *   feature a thing on the dashboard itself: news, add, edit, tagcloud
     *   studio  the theme studio
     *   palette the search palette, opened on a mode prefix ('' = plain search)
     */
    const c = (to) => ({ config: to });
    const v = (to) => ({ view: to });
    const f = (to) => ({ feature: to });
    const p = (prefix) => ({ palette: prefix });
    const STUDIO = 'studio';
    const CHEAT = 'cheat-sheet';
    const NONE = 'none';

    const TIP_DESTINATIONS = {
        // Everyday
        tipEverydayTyping: p(''),
        tipEverydayModes: p(''),
        tipEverydayOverview: c('structure/pages'),
        tipEverydayDensity: c('appearance/layout'),
        tipWatchNews: f('news'),
        tipWatchFeedKey: c('feed-watch'),
        tipWatchPreviewPager: f('news'),
        tipEverydayBell: c('behavior/privacy'),
        // Adding bookmarks
        tipAddPaste: c('inbox/collecting'),
        tipAddImportDestination: c('data-backups'),
        tipAddQuickAdd: f('add'),
        tipAddAnywhere: f('add'),
        tipAddCapture: c('help/inbox'),
        tipAddDuplicate: f('add'),
        tipAddFullModal: f('add'),
        tipAddShortcut: f('add'),
        // Editing and organising
        tipEditDrag: f('edit'),
        tipEditLockLayout: c('behavior/general'),
        tipEditSelectionActions: v('library'),
        tipEditKeep: v('inbox'),
        tipEditTriage: v('inbox'),
        tipEditWorkbench: v('library'),
        tipEditTagSuggestions: c('bookmarks/tag-suggestions'),
        tipEditRenamePage: c('structure/pages'),
        tipEditPageTabDot: c('structure/pages'),
        tipEditCategorySpread: f('edit'),
        tipEditPromote: v('unsorted'),
        tipEditPanel: v('library'),
        tipEditGroup: v('library'),
        tipEditStructure: v('library'),
        // Finding things
        tipFindFilters: p(''),
        tipFindSums: p(''),
        tipFindShortcutMode: c('behavior/search'),
        tipFindGridShortcut: p(''),
        tipFindAllPages: p('@'),
        tipFindFinders: p('?'),
        tipFindTagCloud: f('tagcloud'),
        tipFindTagView: v('tags'),
        tipFindTagColour: c('bookmarks/tags'),
        tipFindRecent: p('*'),
        tipFindAddressBar: p(''),
        tipFindWeb: c('behavior/search'),
        // Keeping it healthy
        tipMaintHealth: v('library'),
        tipMaintBulkCheck: v('library'),
        tipMaintMonitorsPlace: v('library'),
        tipMaintReview: v('library'),
        tipMaintRotReport: v('library'),
        tipMaintMerge: v('library'),
        tipMaintSelectAll: v('inbox'),
        tipMaintMonitorStats: v('library'),
        tipMaintStatsUptime: c('stats/health'),
        tipMaintCert: v('library'),
        tipMaintExpectText: v('library'),
        tipMaintMaintenanceWindow: c('monitoring/schedules'),
        tipMaintTrash: c('data-backups/trash'),
        tipMaintBackup: c('data-backups/backups'),
        tipMaintSignIn: v('library'),
        tipMaintArchive: c('bookmarks/local-copies'),
        tipMaintNote: p(':'),
        tipMaintWorkThrough: v('library'),
        tipMaintCollectionHealth: v('library'),
        tipMaintBulkMute: v('library'),
        // Your self-hosted setup
        tipDataContainers: v('docker'),
        tipHostMonitorWebUI: v('docker'),
        tipDataContainerBookmark: v('docker'),
        tipHostDiscovery: c('containers'),
        tipHostDiscoveryLabels: v('docker'),
        tipHostRunsIn: v('library'),
        tipDataContainerWebUI: v('docker'),
        tipHostOnePlace: c('containers/alerts'),
        tipDataContainerAutoUpdate: c('containers/updates'),
        tipHostHold: v('docker'),
        tipHostLogs: p(':'),
        tipDataContainerColumns: v('docker'),
        tipDataContainerBinds: v('docker'),
        tipGlancesPage: v('glances'),
        tipGlancesKeys: v('glances'),
        tipGlancesBand: v('glances'),
        tipGlancesTrack: v('glances'),
        tipGlancesHosts: c('glances/connection'),
        tipGlancesContainers: v('glances'),
        tipGlancesCommands: p(':'),
        tipGlancesCompare: v('glances'),
        tipGlancesWidget: c('widgets'),
        tipTuneContainerList: c('widgets'),
        tipHostHomelabPage: c('structure/pages'),
        // The assistant
        tipAssistantAsk: p('='),
        tipAssistantApply: c('assistant'),
        tipAssistantOwn: c('assistant'),
        tipAssistantMcp: c('data-backups/webhooks'),
        // Making it yours
        tipTuneInfo: c('overview'),
        tipTuneTheme: p(':'),
        tipTuneThemeBrowser: STUDIO,
        tipTuneThemeBrowserWidth: STUDIO,
        tipTuneGloss: STUDIO,
        tipTuneLooks: STUDIO,
        tipTuneBackdrop: STUDIO,
        tipTuneCardGlass: c('appearance/surface'),
        tipTuneCategoryHeader: c('appearance/layout'),
        tipTuneActionBar: c('appearance/buttonbar'),
        tipTuneActionKeyHint: c('appearance/buttonbar'),
        tipTuneGreeting: c('appearance/datetime'),
        tipTuneAnimations: c('appearance/general'),
        tipTuneSwitcher: p(':'),
        tipTunePreview: c('appearance/previews'),
        tipTuneVideoCard: c('appearance/previews'),
        tipTuneSmartCollections: c('structure/collections'),
        tipTuneReviewOffers: c('behavior/privacy'),
        tipTuneWidgets: c('widgets'),
        tipTuneWidgetFold: c('widgets'),
        tipTuneWidgetTabs: c('widgets'),
        tipTuneWidgetSchedule: c('widgets'),
        tipTuneWidgetMenu: c('widgets'),
        tipTuneCustomWidget: c('widgets'),
        tipTuneAmbientWidgets: c('widgets'),
        tipTuneClockFace: c('widgets'),
        tipTuneDnsWidgets: c('widgets'),
        tipTuneHomeAssistant: c('widgets'),
        tipTuneRssWidget: c('widgets'),
        tipTuneCommands: p(':'),
        tipTuneCommandsMore: p(':'),
        tipTuneInboxConfig: c('inbox'),
        // Config itself
        tipConfigFindValue: c('overview'),
        tipConfigWhatChanged: c('overview'),
        tipConfigLayoutHistory: c('overview'),
        tipConfigHub: c('appearance'),
        tipConfigTours: c('help/start'),
        tipDataSources: c('data-backups/sources'),
        tipDataPortable: c('data-backups'),
        tipDataImportDashboard: c('data-backups'),
        tipDataWebhooks: c('data-backups/webhooks'),
        tipDataBeyondBookmarks: c('stats/collection'),
        tipDataLogs: c('logs/server'),
        // Keys with no place behind them
        tipEverydayGridLetters: CHEAT,
        tipEverydayViews: CHEAT,
        tipEverydayCheatsheet: CHEAT,
        tipConfigKeyboard: CHEAT,
        tipEverydayPages: NONE,
        tipEverydayArrows: NONE,
        tipEverydayEsc: NONE,
        tipEverydayEscHome: NONE,
        tipEverydayGridFilter: NONE,
        tipEverydayScrollBack: NONE,
        tipEditInline: NONE,
        tipEditQuickActions: NONE,
        tipEditUndo: NONE,
        tipEditMoveCategory: NONE,
        tipEditMoveBlockKeys: NONE,
        tipEditCopyUrl: NONE,
        tipEditQrCode: NONE,
    };

    /** The destination of a tip as { kind, target }; the cheat sheet when none is named. */
    function destinationOf(tipId) {
        const d = TIP_DESTINATIONS[tipId];
        if (d === STUDIO) return { kind: 'studio', target: '' };
        if (d?.config) return { kind: 'config', target: d.config };
        if (d?.view) return { kind: 'view', target: d.view };
        if (d?.feature) return { kind: 'feature', target: d.feature };
        if (d && typeof d === 'object' && 'palette' in d) return { kind: 'palette', target: d.palette };
        if (d === CHEAT) return { kind: 'cheat-sheet', target: '' };
        return { kind: 'none', target: '' };
    }

    function openStudio() {
        const d = dash();
        if (!d?.config?.openThemeBrowser) {
            global.location.hash = 'config/appearance';
            return;
        }
        void Promise.resolve(d.config.openThemeBrowser()).catch(() => {
            global.location.hash = 'config/appearance';
        });
    }

    /*
     * The openers a tip can name, as paths from the dashboard instance to the
     * method the rest of the app already uses, so the check that an opener
     * exists and the click that calls it read the same table.
     */
    const VIEW_OPENERS = {
        inbox: ['inbox', 'openInboxView'],
        library: ['config', 'openLibraryView'],
        unsorted: [null, 'openUnsortedBookmarks'],
        tags: ['tagView', 'openAllTags'],
        docker: ['docker', 'openDockerView'],
        glances: ['glances', 'openGlancesView'],
    };

    /** Things on the dashboard itself that a tip can name. */
    const FEATURE_OPENERS = {
        news: [() => global.FeedWatchNews, 'open', { source: 'button' }],
        add: ['quickAddWidget', 'open'],
        edit: ['editMode', 'enter'],
        tagcloud: [() => global.DashboardTagCloud, 'openModal'],
    };

    /** [owner, method, ...args] resolved against the dashboard: { owner, method } or null. */
    function resolveOpener([owner, method]) {
        const d = dash();
        const host = typeof owner === 'function' ? owner() : (owner ? d?.[owner] : d);
        return host && typeof host[method] === 'function' ? { host, method } : null;
    }

    function runOpener(entry) {
        const found = resolveOpener(entry);
        if (found) void found.host[found.method](...entry.slice(2));
    }

    function openPalette(prefix) {
        const search = dash()?.searchComponent;
        // A prefix picks the palette's mode (':' commands, '?' finders ...).
        return search?.openSearchWithQuery?.(prefix);
    }

    /** Whether the opener a destination needs exists, so the button never does nothing. */
    function hasOpener({ kind, target }) {
        const d = dash();
        if (kind === 'config') return Boolean(d?.config?.openConfigView);
        if (kind === 'studio') return Boolean(d?.config?.openThemeBrowser);
        if (kind === 'palette') return Boolean(d?.searchComponent?.openSearchWithQuery);
        if (kind === 'cheat-sheet') return Boolean(d?.showKeyboardCheatSheet);
        if (kind === 'none') return true;
        if (kind === 'view') return Boolean(VIEW_OPENERS[target] && resolveOpener(VIEW_OPENERS[target]));
        if (kind === 'feature') return Boolean(FEATURE_OPENERS[target] && resolveOpener(FEATURE_OPENERS[target]));
        return false;
    }

    /** "Open Appearance": the section's own name, from the Config locale. */
    function configName(target) {
        const section = target.split('/')[0];
        const camel = section.replace(/(^|-)([a-z])/g, (_, __, ch) => ch.toUpperCase());
        const lang = dash()?.language;
        const key = `config.section${camel}`;
        const value = lang?.t ? lang.t(key) : '';
        return value && value !== key ? value : section;
    }

    const VIEW_LABELS = {
        inbox: ['tipGoInbox', 'Open the Inbox'],
        library: ['tipGoLibrary', 'Open the Bookmarks view'],
        unsorted: ['tipGoUnsorted', 'Open Unsorted'],
        tags: ['tipGoTags', 'Open the tag view'],
        docker: ['tipGoDocker', 'Open Containers'],
        glances: ['tipGoGlances', 'Open Glances'],
    };
    const FEATURE_LABELS = {
        news: ['tipGoNews', 'Open the news'],
        add: ['tipGoAdd', 'Add a bookmark'],
        edit: ['tipGoEdit', 'Start editing'],
        tagcloud: ['tipGoTagCloud', 'Open the tag cloud'],
    };

    /** The row's single button, built from where the tip's destination leads. */
    function actionFor(tipId) {
        const dest = destinationOf(tipId);
        if (dest.kind === 'none') return null;
        const base = { name: dest.kind, primary: true, marksRead: true };
        if (dest.kind === 'studio') {
            return { ...base, label: () => t('sessionTipStudioAction', 'Theme studio (Shift+A)'), onClick: openStudio };
        }
        if (dest.kind === 'config') {
            return {
                ...base,
                label: () => t('tipGoConfig', 'Open {name}').replace('{name}', configName(dest.target)),
                onClick: () => { global.location.hash = `config/${dest.target}`; },
            };
        }
        if (dest.kind === 'view') {
            const [key, fallback] = VIEW_LABELS[dest.target];
            return { ...base, label: () => t(key, fallback), onClick: () => runOpener(VIEW_OPENERS[dest.target]) };
        }
        if (dest.kind === 'feature') {
            const [key, fallback] = FEATURE_LABELS[dest.target];
            return { ...base, label: () => t(key, fallback), onClick: () => runOpener(FEATURE_OPENERS[dest.target]) };
        }
        if (dest.kind === 'palette') {
            return { ...base, label: () => t('tipGoPalette', 'Open the palette'), onClick: () => { void openPalette(dest.target); } };
        }
        return {
            ...base,
            label: () => t('sessionTipAction', 'Cheat sheet'),
            onClick: () => dash()?.showKeyboardCheatSheet?.(),
        };
    }

    function source(tipId) {
        return {
            id: bellIdOf(tipId),
            group: 'tips',
            kind: 'tip',
            icon: '\u2328\uFE0F',
            no: 'forever',
            // Reading it counts it as shown right then, so the slot stays empty for today.
            onRead: () => { if (shown.has(tipId)) settle(tipId); },
            // Switching the tips off in Config takes the row away at the next refresh. The day
            // is the row's id: the same tip offered again later is a new row, not a read one.
            state: async () => (dash()?.settings?.enableSessionTips === false || global.DemoLock?.on
                ? null
                : { count: 1, ids: [today()], text: plainText(tipText(tipId)) }),
            actions: actionFor(tipId) ? [actionFor(tipId)] : [],
        };
    }

    /**
     * One look at the bell's tips: settle those that were read, and on a new
     * day put up the day's two. Returns the tip ids now in the bell, or null.
     */
    function tick() {
        if (!global.NotificationBell || !allTipIds().length) return null;
        for (const id of [...shown.keys()]) if (wasReadToday(id)) settle(id);
        const saved = remembered();
        const day = today();
        // A new day brings two new tips, whether or not yesterday's were read. An
        // unread one leaves the bell without being counted as seen.
        if (saved.day !== day) {
            for (const id of [...shown.keys()]) release(id);
            offer(day, saved.ids);
        } else {
            for (const id of saved.ids) {
                if (!shown.has(id) && !wasReadToday(id) && tipText(id)) show(id);
            }
        }
        return shown.size ? [...shown.keys()] : null;
    }

    function show(tipId) {
        const handle = global.NotificationBell.register(source(tipId));
        shown.set(tipId, handle);
        void handle.refresh();
    }

    /** Put today's two tips in the bell, avoiding yesterday's. */
    function offer(day, avoid) {
        if (!shouldShow()) return;
        const next = pickTips(avoid);
        if (!next.length) return;
        remember(next, day);
        rememberOffered(next);
        next.forEach(show);
    }

    let ticker = null;

    function autoStart() {
        if (ticker) return;
        // Shortly after load, then whenever the page is looked at again.
        setTimeout(tick, FIRST_TICK_MS);
        ticker = setInterval(tick, TICK_EVERY_MS);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    }

    global.DashboardKeyboardTip = { autoStart, shouldShow, pickTips, tick, current: () => [...shown.keys()], destinationOf, hasOpener, actionFor, TIP_DESTINATIONS };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart, { once: true });
    } else {
        autoStart();
    }
}(typeof window !== 'undefined' ? window : globalThis));
