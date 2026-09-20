/**
 * Page tabs, navigation, rename, deep links.
 */
class DashboardPageNav {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    async requestPageNavigation(pageId) {
        const d = this.dash;
        const targetPageId = Number(pageId);
        if (!Number.isFinite(targetPageId)) {
            return false;
        }
        // Any non-bookmarks view owns the whole container, so returning to a page
        // has to rebuild it even when the page id is unchanged.
        const leavingView = !d.isBookmarksView();

        if (!(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }

        if (leavingView) {
            // View change already rotates random theme; skip the page-change pick below.
            d._pageNavIncludesViewChange = true;
            d.setActiveView('bookmarks');
            d.inbox?.clearKeyboardSelection?.();
            d.health?.clearKeyboardSelection?.();
        }

        if (targetPageId === Number(d.currentPageId)) {
            if (leavingView) {
                return this.restoreBookmarksViewForPage(targetPageId);
            }
            return true;
        }

        // Track by position only (never the page name) to keep analytics PII-free.
        const targetIndex = d.pages?.findIndex((page) => Number(page.id) === targetPageId);
        if (typeof targetIndex === 'number' && targetIndex >= 0) {
            window.nextdashTrack?.('page-switch', { index: targetIndex });
        }
        return d.loadPageBookmarks(targetPageId, { skipInlineEditConfirm: true });
    }


    restoreBookmarksViewForPage(pageId) {
        const d = this.dash;
        d.setActiveView('bookmarks');
        const targetPageId = Number(pageId);
        const pageIndex = d.pages.findIndex((page) => Number(page.id) === targetPageId);
        try {
            const url = new URL(window.location.href);
            const params = url.searchParams;
            [
                'hv_filter', 'hv_sort', 'hv_q', 'hv_id', 'hv_refresh',
                'ib_filter', 'ib_sort', 'ib_q', 'ib_domain', 'ib_id',
            ].forEach((key) => params.delete(key));
            const query = params.toString();
            const nextHash = pageIndex >= 0 ? `#${pageIndex + 1}` : '';
            const nextUrl = `${url.pathname}${query ? `?${query}` : ''}${nextHash}`;
            if (`${url.pathname}${url.search}${url.hash}` !== nextUrl) {
                // Returning to the grid is a place you can go Back from, so it
                // gets an entry. pushLocation declines while a popstate is
                // being restored, which is when this runs as the restore.
                if (!window.DashboardHistory?.pushLocation?.(nextUrl)) {
                    history.replaceState(history.state, '', nextUrl);
                }
            }
        } catch {
            if (pageIndex >= 0) {
                const nextHash = `#${pageIndex + 1}`;
                if (window.location.hash !== nextHash) {
                    window.location.hash = nextHash;
                }
            }
        }
        const page = d.pages.find((entry) => Number(entry.id) === targetPageId);
        if (page) {
            d.updatePageTitle(page.name);
        }
        d.updateDocumentTitle();
        d.setActivePageNavButton(targetPageId);
        // Where you were before you opened Health, Inbox or config. The render
        // has to happen first — there is nothing tall enough to scroll to yet —
        // and a page that has since grown shorter clamps itself.
        const restoreTo = d.data?.takeRememberedScroll?.(targetPageId) || 0;
        d.renderDashboard({ animate: false });
        if (restoreTo > 0) {
            requestAnimationFrame(() => {
                window.scrollTo({ top: restoreTo, behavior: 'instant' });
            });
        }
        window.ThemeIconStyling?.applyThemeIconStylingToDocument?.(d.settings);
        d.keyboardNavigation?.clearSelection?.();
        d.keyboardNavigation?.scheduleUpdate?.();
        d.inbox?.clearKeyboardSelection?.();
        d.health?.clearKeyboardSelection?.();
        return true;
    }



    /**
     * Title-case a panel breadcrumb for the tab title.
     *
     * The panel trails are lowercase by design ('health › duplicates'); a browser
     * tab reads as a proper name, so each segment is capitalised on the way out.
     */
    capitalizeTrail(trail) {
        return String(trail).split(' › ').map((part) => {
            const s = String(part).trim();
            return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        }).join(' › ');
    }


    inboxPageLabel() {
        const d = this.dash;
        const bc = d.inbox?.headerBreadcrumb?.();
        if (bc) return this.capitalizeTrail(bc);
        const inboxLabel = d.language?.t?.('dashboard.inboxPageTitle');
        return inboxLabel && inboxLabel !== 'dashboard.inboxPageTitle' ? inboxLabel : 'Inbox';
    }


    healthPageLabel() {
        const d = this.dash;
        const bc = d.health?.headerBreadcrumb?.();
        if (bc) return this.capitalizeTrail(bc);
        const healthLabel = d.language?.t?.('dashboard.healthPageTitle');
        return healthLabel && healthLabel !== 'dashboard.healthPageTitle' ? healthLabel : 'Health';
    }


    configPageLabel() {
        const d = this.dash;
        const bc = d.config?.headerBreadcrumb?.();
        if (bc) return this.capitalizeTrail(bc);
        const configLabel = d.language?.t?.('dashboard.config');
        return configLabel && configLabel !== 'dashboard.config' ? configLabel : 'Config';
    }


    unsortedPageLabel() {
        const d = this.dash;
        const unsortedLabel = d.language?.t?.('dashboard.unsorted');
        return unsortedLabel && unsortedLabel !== 'dashboard.unsorted' ? unsortedLabel : 'Unsorted';
    }


    /**
     * The big header names the view only ('config', 'health', …). The trail of
     * sections that used to sit next to it drops to the smaller line below —
     * the same name at the top on every render reads calmer than a heading that
     * grows a new segment on each click.
     */
    updatePageTitle(pageName) {
        const d = this.dash;
        const titleElement = document.querySelector('.title');
        if (titleElement) {
            let displayName;
            if (d.activeView === 'inbox') {
                displayName = this.t('dashboard.inboxPageTitle', 'Inbox').toLowerCase();
            } else if (d.activeView === 'health') {
                displayName = this.t('dashboard.health', 'health');
            } else if (d.activeView === 'config') {
                displayName = this.t('config.viewBreadcrumbRoot', 'Config').toLowerCase();
            } else if (d.activeView === 'unsorted') {
                displayName = this.unsortedPageLabel().toLowerCase();
            } else {
                const defaultTitle = d.language.t('dashboard.defaultPageTitle');
                displayName = pageName || (defaultTitle !== 'dashboard.defaultPageTitle' ? defaultTitle : '');
            }
            titleElement.textContent = displayName;
        }
        this.updatePageBreadcrumb();
    }


    /**
     * Fills the smaller line under the header with the full trail. Left empty
     * wherever the trail is just the view name again: repeating 'health'
     * directly under 'health' is noise, not orientation.
     *
     * Config, health, and inbox are absent on purpose — their trails belong to
     * the section heading in the panel, next to the section they describe,
     * rather than out in the left-hand column under the view name.
     */
    updatePageBreadcrumb() {
        const el = document.querySelector('.title-breadcrumb');
        if (!el) return;

        el.textContent = '';
        el.hidden = true;
    }


    t(key, fallback) {
        const value = this.dash.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }


    updateDocumentTitle() {
        const d = this.dash;
        const viewName = d.activeView === 'inbox'
            ? this.inboxPageLabel()
            : (d.activeView === 'health'
                ? this.healthPageLabel()
                : (d.activeView === 'config'
                    ? this.configPageLabel()
                    : (d.activeView === 'unsorted' ? this.unsortedPageLabel() : '')));
        if (viewName) {
            if (d.settings?.enableCustomTitle) {
                const base = (d.settings.customTitle || '').trim();
                if (base) {
                    document.title = d.settings.showPageInTitle
                        ? `${viewName} — ${base}`
                        : base;
                } else {
                    document.title = `${viewName} — nextDash`;
                }
            } else {
                document.title = `${viewName} — nextDash`;
            }
            return;
        }
        const currentPage = d.pages && d.currentPageId
            ? d.pages.find((p) => d.samePageId(p.id, d.currentPageId))
            : null;
        const pageName = currentPage?.name || '';

        if (d.settings?.enableCustomTitle) {
            const base = (d.settings.customTitle || '').trim();
            if (base) {
                document.title = d.settings.showPageInTitle && pageName
                    ? `${pageName} — ${base}`
                    : base;
            } else {
                document.title = pageName || 'nextDash';
            }
        } else {
            document.title = pageName ? `${pageName} — nextDash` : 'nextDash';
        }
    }

    /** Inline page-tab rename (name/icon/color) — desktop/tablet landscape only. */

    allowsPageTabInlineEdit() {
        return window.MobileExperience?.isMobileLayout?.() !== true;
    }


    setActivePageNavButton(pageId) {
        const d = this.dash;
        const container = document.getElementById('page-navigation');
        if (!container) {
            return;
        }
        const targetPageId = Number(pageId);
        const pageIndex = d.pages.findIndex((page) => Number(page.id) === targetPageId);
        container.querySelectorAll('.page-nav-btn').forEach((btn, index) => {
            // The page you were last on stays marked in config, health and the
            // inbox: it is where the dashboard button and Escape take you back.
            const selected = index === pageIndex;
            btn.classList.toggle('active', selected);
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');
            btn.tabIndex = selected ? 0 : -1;
        });
        // Which tabs the strip can show depends on which one is active: the
        // page you are on is never the one folded away. Switching pages moves
        // that marker without rebuilding the strip, so the fit has to be taken
        // again here -- without it, navigating to a folded-away page left the
        // strip showing the first few and no sign of where you actually were.
        this.fitPageTabs();

        const inboxBtn = document.getElementById('page-nav-inbox-btn');
        if (inboxBtn) {
            const inboxSelected = d.activeView === 'inbox';
            inboxBtn.classList.toggle('active', inboxSelected);
            inboxBtn.setAttribute('aria-selected', inboxSelected ? 'true' : 'false');
            inboxBtn.tabIndex = inboxSelected ? 0 : -1;
        }
        // The health and config icons live in the header, outside this container,
        // but are the same kind of destination — keep their active state in step
        // with the tabs.
        d.visual?.syncUnsortedLinkActiveState?.();
        d.visual?.syncHealthLinkActiveState?.();
        d.visual?.syncConfigLinkActiveState?.();
        d.visual?.syncDashboardLinkActiveState?.();
        // The inbox tab is built here, so this is where the destination cluster
        // can go from empty to occupied.
        d.visual?.syncHeaderZoneDividers?.();
        this.syncPageWalkButtons();
    }


    setActiveInboxTab() {
        this.setActivePageNavButton(this.dash.currentPageId);
        this.updatePageTitle();
        this.updateDocumentTitle();
    }


    /** Health has no tab of its own: it opens from the header icon. */
    setActiveHealthTab() {
        this.setActivePageNavButton(this.dash.currentPageId);
        this.updatePageTitle();
        this.updateDocumentTitle();
    }


    /** Unsorted has no tab of its own either: same header-icon route as health. */
    setActiveUnsortedTab() {
        this.setActivePageNavButton(this.dash.currentPageId);
        this.updatePageTitle();
        this.updateDocumentTitle();
    }


    /** Config has no tab of its own either: it opens from the header link. */
    setActiveConfigTab() {
        this.setActivePageNavButton(this.dash.currentPageId);
        this.updatePageTitle();
        this.updateDocumentTitle();
    }


    updateInboxTabBadge() {
        const d = this.dash;
        const badge = document.getElementById('page-inbox-badge');
        const inboxBtn = document.getElementById('page-nav-inbox-btn');
        if (!badge) {
            return;
        }
        const unread = d.inbox?.unreadCount?.() || 0;
        const previous = Number(this._lastInboxBadgeCount) || 0;
        if (unread > 0) {
            badge.textContent = String(unread);
            badge.hidden = false;
            badge.classList.add('is-inbox-badge-visible', 'is-inbox-badge-live');
            if (unread > previous) {
                badge.classList.remove('is-inbox-badge-pop');
                // Force reflow so repeated increases replay the pop animation.
                void badge.offsetWidth;
                badge.classList.add('is-inbox-badge-pop');
                badge.addEventListener('animationend', () => {
                    badge.classList.remove('is-inbox-badge-pop');
                }, { once: true });
            }
        } else {
            badge.textContent = '';
            badge.hidden = true;
            badge.classList.remove('is-inbox-badge-visible', 'is-inbox-badge-live', 'is-inbox-badge-pop');
            inboxBtn?.classList.remove('is-inbox-new');
        }
        this._lastInboxBadgeCount = unread;
        this.syncInboxTabHighlight();
    }


    isInboxTabHighlightActive() {
        const d = this.dash;
        if (!d.inbox?.isEnabled?.() || d.settings?.inboxShowInPageTabs === false) {
            return false;
        }
        if ((d.inbox?.unreadCount?.() || 0) <= 0) {
            return false;
        }
        try {
            if (localStorage.getItem('nextdash:inbox-tab-opened-v1') === '1') {
                return false;
            }
        } catch {
            return false;
        }
        return true;
    }


    syncInboxTabHighlight() {
        const btn = document.getElementById('page-nav-inbox-btn');
        if (!btn) {
            return;
        }
        btn.classList.toggle('is-inbox-new', this.isInboxTabHighlightActive());
    }


    markInboxTabDiscovered() {
        try {
            localStorage.setItem('nextdash:inbox-tab-opened-v1', '1');
        } catch { /* ignore */ }
        this.syncInboxTabHighlight();
    }


    /**
     * What the header gives up, and in which order, as the window narrows.
     *
     * The row is one line by design, and every zone in it has a natural width;
     * once they no longer add up, something has to go. Left to the browser that
     * "something" is whatever happens to be last, so the order is set here
     * instead, cheapest first:
     *
     *   1. the destinations (inbox, health, config) -- every one of them has a
     *      key and a place in the pages panel;
     *   2. the actions -- same bargain, their keys all still work;
     *   3. the pages button -- the `,` panel it opens is a key away;
     *   4. the page strip folds to the page you are on plus the chip that
     *      counts the rest, which is a page switcher in one control;
     *   5. the clock and the weather, leaving the name and the switcher.
     *
     * Measured rather than guessed at fixed widths: the zones' widths depend on
     * the page name, the reader's font size, how many actions are switched on
     * and which language the labels are in, so a breakpoint that fits one
     * install crops another.
     */
    fitHeaderZones() {
        const row = document.querySelector('.dashboard-section.section-controls .header-top');
        if (!row) return;

        const available = row.clientWidth;
        if (!available) return;

        const apply = (step) => {
            document.body.setAttribute('data-header-fit', String(step));
            if (step >= 3) this.fitPageTabs();
        };

        /*
         * What the row needs, as against what it has.
         *
         * Measured per zone rather than by summing row.children: the identity
         * is `display: contents` in the default clock placement, so the row's
         * children are not the zones -- and the track is the one that shrinks,
         * which is exactly why an overflow never shows up in scrollWidth.
         */
        const needs = () => {
            const gap = parseFloat(window.getComputedStyle(row).columnGap) || 0;

            /*
             * The zones are found, not listed.
             *
             * Several wrappers in the header are `display: contents` -- the
             * identity block, the primary block inside it, the date element --
             * so the boxes on the row are their grandchildren, and a wrapper
             * measures 0 while the clock standing in its place takes 270px.
             * Naming the wrappers therefore said "everything fits" at a width
             * where the track had been squeezed to 62px. What counts is every
             * descendant that actually takes a column: walk down through the
             * transparent ones and stop at the first box.
             */
            const atoms = [];
            const walk = (el) => {
                [...el.children].forEach((child) => {
                    if (child.hidden) return;
                    const style = window.getComputedStyle(child);
                    if (style.display === 'none') return;
                    if (style.display === 'contents') { walk(child); return; }
                    /*
                     * Something that spans the row has a line to itself, so it
                     * competes with nothing: the classic clock placement puts
                     * the view's name on its own line under the controls, and
                     * counted among them a 1300px name meant the row was
                     * always too full -- the ladder then hid the clock and the
                     * actions on a window with room to spare.
                     */
                    if (style.gridColumn === '1 / -1') return;
                    /*
                     * Something that spans the row has a line to itself, so it
                     * competes with nothing: the classic clock placement puts
                     * the view's name on its own line under the controls, and
                     * counted among them a 1300px name meant the row was
                     * always too full -- the ladder then hid the clock and the
                     * actions on a window with room to spare.
                     */
                    /*
                     * Something that spans the row has a line to itself, so it
                     * competes with nothing: the classic clock placement puts
                     * the view's name on its own line under the controls, and
                     * counted among them a 1300px name meant the row was
                     * always too full -- the ladder then hid the clock and the
                     * actions on a window with room to spare.
                     */
                    atoms.push(child);
                });
            };
            walk(row);

            let needed = 0;
            let parts = 0;
            atoms.forEach((el) => {
                // The track is the one zone that may be drawn smaller than it
                // is: what it needs is one tab and the chip, not its width.
                const width = el.classList.contains('header-track')
                    ? this.trackMinimumWidth(el)
                    : el.getBoundingClientRect().width;
                if (width <= 0) return;
                needed += width;
                parts += 1;
            });
            return needed + Math.max(0, parts - 1) * gap;
        };

        for (let step = 0; step <= 4; step += 1) {
            apply(step);
            if (needs() <= available) break;
        }
        // The cap follows the step, so the strip is drawn once the ladder has
        // settled: stepping through 4 on the way to 2 otherwise left it folded
        // to one tab with room to spare.
        this.fitPageTabs();
        // The actions read the same rung: past the first one, each fold takes
        // one more button off the bar and puts it behind the "+N".
        this.dash.syncHeaderActionOverflow?.();
    }


    /**
     * The narrowest the page strip can be drawn: one tab and the chip.
     *
     * Read off the strip rather than assumed, because a tab is as wide as the
     * page it names -- "1" and "infrastructure" are the same control.
     */
    trackMinimumWidth(track) {
        const gap = parseFloat(window.getComputedStyle(track).columnGap) || 0;
        const active = track.querySelector('.page-nav-btn.active') || track.querySelector('.page-nav-btn');
        const chip = track.querySelector('.page-nav-overflow');
        let min = 0;
        if (active) min += active.getBoundingClientRect().width;
        if (chip) min += chip.getBoundingClientRect().width + gap;
        [...track.querySelectorAll('.page-walk-hint')].forEach((hint) => {
            if (window.getComputedStyle(hint).display === 'none') return;
            min += hint.getBoundingClientRect().width + gap;
        });
        return min;
    }


    /**
     * How many page tabs the strip draws at most.
     *
     * The same reading the server does, so a value that has not been round
     * tripped yet draws the same strip it will after a reload: 3-9, and zero
     * -- what a settings file written before this setting carries -- means
     * nobody chose, which is the default rather than the floor.
     */
    /**
     * How the pages are drawn: 'segmented', 'text' or 'compact'.
     *
     * Read from the settings rather than from <body>, so a value that has not
     * been round tripped yet draws the same switcher it will after a reload --
     * the same reading the server does.
     */
    /**
     * The two keys printed beside the strip are buttons as well.
     *
     * They have always said what Shift+Left and Shift+Right do; a reader with a
     * pointer had to take that as advice rather than as a control. They walk
     * one page now, and they stop at the ends: the keys wrap around, a button
     * that looks pressable and does nothing does not. With one page there is
     * nowhere to walk, so both are disabled.
     */
    syncPageWalkButtons() {
        const d = this.dash;
        const buttons = [...document.querySelectorAll('.header-track .page-walk-hint')];
        if (!buttons.length) return;
        const pages = Array.isArray(d.pages) ? d.pages : [];
        const at = pages.findIndex((page) => d.samePageId(page.id, d.currentPageId));
        buttons.forEach((btn) => {
            const step = btn.dataset.pageWalk === 'prev' ? -1 : 1;
            const target = at < 0 ? -1 : at + step;
            const page = target >= 0 && target < pages.length ? pages[target] : null;
            btn.disabled = !page;
            btn.setAttribute('aria-disabled', page ? 'false' : 'true');
            if (!btn.dataset.walkBound) {
                btn.dataset.walkBound = '1';
                btn.addEventListener('click', () => {
                    const pos = pages.findIndex((p) => d.samePageId(p.id, d.currentPageId));
                    const next = this.dash.pages?.[pos + step];
                    if (next) void this.requestPageNavigation(next.id);
                });
            }
        });
    }


    pageSwitcherStyle() {
        const raw = this.dash?.settings?.pageSwitcherStyle;
        return ['text', 'segmented', 'compact'].includes(raw) ? raw : 'classic';
    }


    pageTabCap() {
        // The compact switcher is one tab by definition: it names the page you
        // are on and the panel behind it holds the rest.
        if (this.pageSwitcherStyle() === 'compact') return 1;
        // Step 3 of the ladder: the strip folds to the page you are on and the
        // chip that counts the rest -- see fitHeaderZones().
        if (Number(document.body.getAttribute('data-header-fit')) >= 3) return 1;
        // And on the narrow layout that is the only shape there is room for:
        // the row holds the name and one switcher, and the panel behind the
        // chip lists every page.
        if (window.matchMedia?.('(max-width: 767px)')?.matches) return 1;
        const raw = Math.round(Number(this.dash?.settings?.maxPageTabs));
        if (!Number.isFinite(raw) || raw === 0) return 5;
        return Math.min(9, Math.max(3, raw));
    }

    /**
     * Show the tabs that fit on one line, and count the rest on a chip.
     *
     * The track used to wrap, so a twelfth page added a second row to the
     * header and carried the toolbar icons down with it. It is one line now,
     * which means something has to decide what does not fit -- and a tab that
     * does not fit is hidden rather than clipped, because a clipped tab is
     * still focusable and tabbing to something invisible is worse than not
     * having it at all.
     *
     * The active tab is never the one dropped: you have to be able to see
     * where you are. If it falls outside the budget it takes the place of the
     * last tab that fitted.
     *
     * Width is not the only limit. A tab labelled "7" is 28px wide where one
     * labelled "websites" is 87px, so measuring alone let the same header carry
     * ten tabs with page names off and four with them on. maxPageTabs is the
     * count that holds either way; the width pass can still show fewer.
     */
    fitPageTabs() {
        const container = document.getElementById('page-navigation');
        if (!container) return;

        const chip = container.querySelector('.page-nav-overflow');
        if (chip) chip.remove();
        const tabs = [...container.querySelectorAll('.page-nav-btn')];
        tabs.forEach((tab) => { tab.hidden = false; });
        if (!tabs.length) return;

        // The gap between tabs counts towards the budget as much as the tabs do.
        const gap = parseFloat(window.getComputedStyle(container).columnGap) || 0;

        // The room to fill is the zone's, not the track's own.
        //
        // The track is content-sized so the walk hints stay beside the tabs
        // rather than at the far ends of the header, which means its width is
        // whatever its tabs happen to need -- measuring against that says
        // "everything fits" while the last tab runs off the header. What is
        // actually available is the zone minus the hints standing in it.
        const zone = container.closest('.header-track');
        let budget = container.clientWidth;
        if (zone) {
            const zoneStyle = window.getComputedStyle(zone);
            const zoneGap = parseFloat(zoneStyle.columnGap) || 0;
            const taken = [...zone.children]
                .filter((el) => el !== container && !el.hidden)
                .reduce((sum, el) => sum + el.getBoundingClientRect().width + zoneGap, 0);
            budget = zone.clientWidth - taken;
        }
        const cap = this.pageTabCap();

        /*
         * The cap holds even when nothing can be measured.
         *
         * A header that is not laid out yet -- a view still opening, a hidden
         * ancestor, a frame that runs before the fonts land -- reports a zone
         * of zero, and the width walk below has nothing to walk. Returning
         * there used to leave every tab shown, because the first thing this
         * does is unhide them all: ten pages, no chip, a second row. The cap
         * needs no measurement, so it is applied first and the width walk only
         * narrows it further.
         */
        let shown = Math.min(cap, tabs.length);
        /*
         * Classic stands in a column sized by its own tabs, so its width is
         * never a budget: measured against it, the room kept for the chip
         * pushed out the second tab of three. The name beside it gives way
         * first, and a window too narrow for both is the header-fit ladder's
         * to handle -- which caps the strip at one from step 3.
         */
        if (this.pageSwitcherStyle() === 'classic') {
            budget = Number.POSITIVE_INFINITY;
        }
        if (!budget || budget < 0) {
            // And try again once the header has a width to report.
            if (!this._pageTabRefitQueued) {
                this._pageTabRefitQueued = true;
                requestAnimationFrame(() => {
                    this._pageTabRefitQueued = false;
                    this.fitPageTabs();
                });
            }
        } else {
            // Room kept for the chip itself, so adding it cannot push out the
            // tab it was measured against. Its own width is not knowable until
            // it exists, and a tab is the closest thing to it that does.
            const chipRoom = tabs[0].getBoundingClientRect().width + gap;
            let used = 0;
            shown = 0;
            for (const tab of tabs) {
                if (shown >= cap) break;
                const width = tab.getBoundingClientRect().width;
                const next = used + width + (shown ? gap : 0);
                // Everything fits, or this one still does with room left for a chip.
                const isLast = tab === tabs[tabs.length - 1] && tabs.length <= cap;
                if (next <= budget - (isLast ? 0 : chipRoom)) {
                    used = next;
                    shown += 1;
                    continue;
                }
                break;
            }
        }

        if (shown >= tabs.length) return;
        if (shown < 1) shown = 1;

        const visible = tabs.slice(0, shown);
        const hidden = tabs.slice(shown);
        const active = tabs.find((tab) => tab.classList.contains('active'));
        if (active && hidden.includes(active)) {
            // It trades places with the last tab that fitted, and the trade is
            // made by hiding one and showing the other -- not by moving either.
            // A hidden tab takes no room, so the active one still paints in the
            // slot the displaced tab gave up, directly before the chip. Moving
            // it would also break setActivePageNavButton, which reads the page
            // a tab stands for from its position among its siblings.
            const displaced = visible[visible.length - 1];
            hidden.splice(hidden.indexOf(active), 1);
            hidden.push(displaced);
        }
        hidden.forEach((tab) => { tab.hidden = true; });

        const d = this.dash;
        /*
         * Compact has no chip: the control is the way in.
         *
         * The chip counts what the row could not show and opens the full
         * panel. In compact nothing is shown but the page you are on, so the
         * count would be "every other page" -- which the control beside it
         * already offers, in a menu, without a modal.
         */
        if (this.pageSwitcherStyle() === 'compact') return;
        const more = document.createElement('button');
        more.type = 'button';
        // Deliberately not .page-nav-btn: fitPageTabs runs again on resize, and
        // a chip wearing the tab class would be measured as a tab and then
        // hidden behind a second chip.
        more.className = 'page-nav-overflow';
        // Count, chevron, key: what is folded away, that it opens downward, and
        // the key that opens it without the pointer.
        more.innerHTML = ''
            + `<span class="page-nav-overflow-count">+${hidden.length}</span>`
            + '<svg class="page-nav-overflow-caret" viewBox="0 0 24 24" width="12" height="12" fill="none"'
            + ' stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'
            + ' aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>'
            + '<span class="page-nav-overflow-key" aria-hidden="true">,</span>';
        more.setAttribute('aria-label',
            d.formatDashboardLabel('pageTabsOverflow', { n: hidden.length }, `${hidden.length} more pages`));
        more.title = more.getAttribute('aria-label');
        // The whole list already has a home; the chip is a way to it.
        more.addEventListener('click', () => d.showPageOverlay?.());
        container.appendChild(more);
    }

    /**
     * Re-measure when the header's width changes.
     *
     * Bound once, and to the container rather than to the window: the track's
     * cap is a share of the viewport, so it also moves when a side panel opens
     * or the zoom changes, neither of which fires a resize.
     */
    observePageTabFit() {
        /*
         * Crossing the phone breakpoint changes the cap, not the container's
         * width, so a ResizeObserver on the track can miss it: the row is
         * already as wide as it will get by the time the media query flips.
         */
        /*
         * And once more when the page has finished arriving.
         *
         * The first fit runs on markup whose web font may not have landed yet,
         * so every zone is measured in the fallback face -- narrower for some
         * scripts, wider for others -- and nothing re-runs, because no element
         * changed size enough for the observer to fire.
         */
        if (!this._pageTabFontsHooked && document.fonts?.ready) {
            this._pageTabFontsHooked = true;
            document.fonts.ready.then(() => {
                this.fitHeaderZones();
                this.fitPageTabs();
            }).catch(() => { /* the observer below still covers resizes */ });
        }

        if (!this._pageTabMediaQuery && typeof window.matchMedia === 'function') {
            this._pageTabMediaQuery = window.matchMedia('(max-width: 767px)');
            this._pageTabMediaQuery.addEventListener?.('change', () => {
                this.fitHeaderZones();
                this.fitPageTabs();
            });
        }
        if (this._pageTabFitObserver) return;
        const container = document.getElementById('page-navigation');
        if (!container || typeof ResizeObserver === 'undefined') return;
        let frame = 0;
        this._pageTabFitObserver = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                this.fitHeaderZones();
                this.fitPageTabs();
            });
        });
        this._pageTabFitObserver.observe(container);
    }

    renderPageNavigation() {
        const d = this.dash;
        const container = document.getElementById('page-navigation');
        if (!container) return;

        const inboxHost = document.getElementById('page-nav-inbox-host');
        if (inboxHost) {
            inboxHost.innerHTML = '';
        }

        container.innerHTML = '';
        container.setAttribute('role', 'tablist');
        const tabsLabel = d.formatDashboardLabel('pageTabsAria', {}, 'Dashboard pages');
        container.setAttribute('aria-label', tabsLabel);

        let activeBtn = null;
        d.pages.forEach((page, index) => {
            const pageBtn = document.createElement('button');
            pageBtn.type = 'button';
            pageBtn.className = 'page-nav-btn';
            pageBtn.setAttribute('role', 'tab');
            const isActive = d.isBookmarksView() && d.samePageId(page.id, d.currentPageId);
            pageBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            // 1–9 switch pages, and the tab itself never said so. Sighted users
            // get the hint from the tooltip; this is how it reaches a screen
            // reader. Only the first nine: there is no key for the tenth tab.
            if (index < 9) {
                pageBtn.setAttribute('aria-keyshortcuts', String(index + 1));
            }
            pageBtn.tabIndex = isActive ? 0 : -1;
            if (isActive) {
                pageBtn.classList.add('active');
                activeBtn = pageBtn;
            }
            this._renderPageTabContent(pageBtn, page, index);
            const prefetchPage = () => {
                d.data?.prefetchPageData?.(page.id);
            };
            pageBtn.addEventListener('mouseenter', prefetchPage, { passive: true });
            pageBtn.addEventListener('focus', prefetchPage, { passive: true });
            pageBtn.addEventListener('click', async () => {
                // The compact switcher is a way into the list, not a tab: the
                // one control on the row names the page you are on, so pressing
                // it opens the panel that holds every page.
                if (this.pageSwitcherStyle() === 'compact') {
                    this.togglePageSwitcherMenu(pageBtn);
                    return;
                }
                const switched = await this.requestPageNavigation(page.id);
                if (!switched) {
                    return;
                }
                pageBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            });
            pageBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pageBtn.click();
                }
            });
            pageBtn.addEventListener('dblclick', (e) => {
                if (!this.allowsPageTabInlineEdit()) return;
                e.preventDefault();
                this._startPageTabRename(pageBtn, page, index);
            });
            container.appendChild(pageBtn);
        });

        if (d.inbox?.isEnabled?.() && d.settings?.inboxShowInPageTabs !== false) {
            const inboxBtn = document.createElement('button');
            inboxBtn.type = 'button';
            inboxBtn.className = 'page-nav-btn page-nav-btn--inbox';
            inboxBtn.id = 'page-nav-inbox-btn';
            inboxBtn.setAttribute('role', 'tab');
            // Marks a tab that opens a view rather than a page — see setActivePageNavButton.
            inboxBtn.setAttribute('data-view-tab', 'inbox');
            const inboxActive = d.activeView === 'inbox';
            inboxBtn.setAttribute('aria-selected', inboxActive ? 'true' : 'false');
            inboxBtn.tabIndex = inboxActive ? 0 : -1;
            if (inboxActive) {
                inboxBtn.classList.add('active');
                activeBtn = inboxBtn;
            }
            const inboxLabel = d.language?.t?.('dashboard.inboxPageTitle');
            const inboxName = inboxLabel && inboxLabel !== 'dashboard.inboxPageTitle' ? inboxLabel : 'Inbox';
            inboxBtn.setAttribute('aria-label', inboxName);
            inboxBtn.setAttribute('aria-keyshortcuts', 'Shift+I');
            inboxBtn.title = inboxName;
            inboxBtn.innerHTML = `
                <svg class="page-tab-icon page-tab-icon--svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <path d="M4 14h4l1.5 2.5h5L16 14h4"/>
                    <path d="M4 14v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>
                    <path d="M12 4v6m0 0l-2.5-2.5M12 10l2.5-2.5"/>
                </svg>
                <span class="page-inbox-badge" id="page-inbox-badge" hidden></span>
            `;
            inboxBtn.addEventListener('click', async () => {
                const opened = await d.inbox?.openInboxView?.();
                if (opened) {
                    inboxBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                }
            });
            inboxBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    inboxBtn.click();
                }
            });
            (inboxHost || container).appendChild(inboxBtn);
            this.updateInboxTabBadge();
            this.syncInboxTabHighlight();
        }

        this.syncPageWalkButtons();

        // Measured after the tabs are in the DOM: widths are not knowable before
        // the browser has laid them out.
        requestAnimationFrame(() => {
            this.fitHeaderZones();
            this.fitPageTabs();
        });
        this.observePageTabFit();

        if (activeBtn) {
            requestAnimationFrame(() => activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        }

        const navRoot = container.closest('.header-actions') || container;
        if (d._pageNavKeyHandler && d._pageNavKeyRoot) {
            d._pageNavKeyRoot.removeEventListener('keydown', d._pageNavKeyHandler);
        }
        d._pageNavKeyRoot = navRoot;
        d._pageNavKeyHandler = (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                return;
            }
            const tabs = [
                ...Array.from(container.querySelectorAll('.page-nav-btn')),
                ...(inboxHost ? Array.from(inboxHost.querySelectorAll('.page-nav-btn')) : []),
            ];
            if (tabs.length === 0) {
                return;
            }
            if (!tabs.includes(document.activeElement)) {
                return;
            }
            let idx = tabs.findIndex((tab) => tab === document.activeElement);
            if (idx < 0) {
                idx = tabs.findIndex((tab) => tab.classList.contains('active'));
            }
            if (idx < 0) {
                return;
            }
            e.preventDefault();
            if (e.key === 'Home') {
                idx = 0;
            } else if (e.key === 'End') {
                idx = tabs.length - 1;
            } else if (e.key === 'ArrowRight') {
                idx = (idx + 1) % tabs.length;
            } else {
                idx = (idx - 1 + tabs.length) % tabs.length;
            }
            tabs.forEach((tab, i) => {
                tab.tabIndex = i === idx ? 0 : -1;
            });
            tabs[idx].focus({ preventScroll: true });
            tabs[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };
        navRoot.addEventListener('keydown', d._pageNavKeyHandler);

        d.updateMiniStatusLine();
    }


    _renderPageTabContent(btn, page, index) {
        const d = this.dash;
        btn.innerHTML = '';
        if (page.icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'page-tab-icon';
            iconEl.textContent = page.icon;
            btn.appendChild(iconEl);
        }
        if (page.color) {
            const dot = document.createElement('span');
            dot.className = 'page-tab-dot';
            dot.style.background = page.color;
            btn.appendChild(dot);
        }
        const label = document.createElement('span');
        label.className = 'page-tab-label';
        label.textContent = d.settings.showPageNamesInTabs ? page.name : (index + 1).toString();
        btn.appendChild(label);

        // The key that switches to this page, printed small and high beside its
        // name -- the way a footnote marks a line. Only with names shown: a
        // numbered tab already *is* its key, and 1 with a superscript 1 beside
        // it says the same thing twice. Only the first nine, because that is
        // how many keys there are.
        if (d.settings.showPageNamesInTabs && index < 9) {
            const key = document.createElement('sup');
            key.className = 'page-tab-key';
            key.setAttribute('aria-hidden', 'true');
            key.textContent = String(index + 1);
            btn.appendChild(key);
        }

        /*
         * Compact is one control naming the page you are on, and what it does
         * is open the list of pages.
         */
        if (this.pageSwitcherStyle() === 'compact') {
            // The caret itself is drawn in CSS, on the active tab; what is said
            // here is what it means -- this control opens something.
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', this._pageSwitcherMenu ? 'true' : 'false');
        }

        // With names switched off the tab reads as a bare "1", which is what a
        // screen reader announces and what a tooltip would have said too. The
        // page's own name is the useful part, so it is carried here regardless
        // of whether the label shows it. Set on every render, including after a
        // rename, because this method is what redraws the tab then.
        const pageName = String(page.name || '').trim();
        const accessible = pageName
            ? d.formatDashboardLabel('pageTabAria', { name: pageName, number: index + 1 },
                `${pageName} — page ${index + 1}`)
            : d.formatDashboardLabel('pageTabAriaNumbered', { number: index + 1 },
                `Page ${index + 1}`);
        btn.setAttribute('aria-label', accessible);
        btn.title = accessible;
    }

    /**
     * The compact switcher's own list.
     *
     * Compact used to be one tab that opened the full pages panel -- a modal
     * over the page, with its own scroll and its own way out, to answer "which
     * page am I going to". The list is short and the question is small, so it
     * is answered where it is asked: a menu under the control, on the surface
     * every other menu in the product stands on.
     */
    static SWITCHER_FILTER_FROM = 8;

    togglePageSwitcherMenu(anchorEl) {
        if (this._pageSwitcherMenu) {
            this.closePageSwitcherMenu();
            return;
        }
        this.openPageSwitcherMenu(anchorEl);
    }

    closePageSwitcherMenu({ focusAnchor = false } = {}) {
        const menu = this._pageSwitcherMenu;
        if (!menu) return;
        this._pageSwitcherMenu = null;
        menu.remove();
        document.removeEventListener('pointerdown', this._pageSwitcherOutside, true);
        window.removeEventListener('keydown', this._pageSwitcherKeys, true);
        window.removeEventListener('resize', this._pageSwitcherReflow);
        this._pageSwitcherOutside = null;
        this._pageSwitcherKeys = null;
        this._pageSwitcherReflow = null;
        const anchor = this._pageSwitcherAnchor;
        this._pageSwitcherAnchor = null;
        anchor?.setAttribute('aria-expanded', 'false');
        if (focusAnchor) anchor?.focus?.({ preventScroll: true });
    }

    openPageSwitcherMenu(anchorEl) {
        const d = this.dash;
        const pages = Array.isArray(d.pages) ? d.pages : [];
        if (!anchorEl || !pages.length) return;

        const menu = document.createElement('div');
        // The one menu surface in the product: the context menus, the move
        // picker and the check-mode popover all stand on it, and it is the one
        // that carries no backdrop-filter -- blur on a menu is what gave Safari
        // a composited layer that hit-tests in front of what it covers.
        menu.className = 'move-popover page-switcher-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label',
            d.formatDashboardLabel('pageTabsAria', {}, 'Dashboard pages'));

        const withFilter = pages.length > DashboardPageNav.SWITCHER_FILTER_FROM;
        if (withFilter) {
            const filterWrap = document.createElement('div');
            filterWrap.className = 'page-switcher-filter';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'page-switcher-filter-input';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.placeholder = d.formatDashboardLabel('pageOverviewFilter', {}, 'Filter pages…');
            input.setAttribute('aria-label', input.placeholder);
            filterWrap.appendChild(input);
            menu.appendChild(filterWrap);
        }

        const list = document.createElement('div');
        list.className = 'page-switcher-list';
        menu.appendChild(list);

        pages.forEach((page, index) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'page-switcher-item';
            row.setAttribute('role', 'menuitem');
            const current = d.isBookmarksView() && d.samePageId(page.id, d.currentPageId);
            if (current) {
                row.classList.add('is-current');
                row.setAttribute('aria-current', 'page');
            }
            row.dataset.pageName = String(page.name || '').toLowerCase();
            row.innerHTML = ''
                + `<span class="page-switcher-item-name"></span>`
                + (index < 9 ? `<span class="page-switcher-item-key">${index + 1}</span>` : '');
            row.querySelector('.page-switcher-item-name').textContent = page.name || String(index + 1);
            row.addEventListener('click', async () => {
                this.closePageSwitcherMenu();
                await this.requestPageNavigation(page.id);
            });
            list.appendChild(row);
        });

        const foot = document.createElement('div');
        foot.className = 'page-switcher-foot';

        const addRow = document.createElement('button');
        addRow.type = 'button';
        addRow.className = 'page-switcher-item page-switcher-add';
        addRow.setAttribute('role', 'menuitem');
        addRow.innerHTML = ''
            + `<span class="page-switcher-item-name">${this._escapeSwitcher(
                d.formatDashboardLabel('pageOverviewNewPage', {}, 'New page'))}</span>`
            + '<span class="page-switcher-item-key">⇧N</span>';
        addRow.addEventListener('click', () => this._openSwitcherCreateRow(menu, addRow));
        foot.appendChild(addRow);

        const allRow = document.createElement('button');
        allRow.type = 'button';
        allRow.className = 'page-switcher-item page-switcher-all';
        allRow.setAttribute('role', 'menuitem');
        allRow.innerHTML = ''
            + `<span class="page-switcher-item-name">${this._escapeSwitcher(
                d.formatDashboardLabel('pageSwitcherAllPages', {}, 'All pages'))}</span>`
            + '<span class="page-switcher-item-key">,</span>';
        allRow.addEventListener('click', () => {
            this.closePageSwitcherMenu();
            d.showPageOverlay?.();
        });
        foot.appendChild(allRow);
        menu.appendChild(foot);

        document.body.appendChild(menu);
        this._pageSwitcherMenu = menu;
        this._pageSwitcherAnchor = anchorEl;
        anchorEl.setAttribute('aria-expanded', 'true');
        this._positionPageTabPopover(menu, anchorEl, { initial: true });

        this._pageSwitcherReflow = () => this._positionPageTabPopover(menu, anchorEl);
        window.addEventListener('resize', this._pageSwitcherReflow);

        this._pageSwitcherOutside = (e) => {
            if (menu.contains(e.target) || anchorEl.contains(e.target)) return;
            this.closePageSwitcherMenu();
        };
        document.addEventListener('pointerdown', this._pageSwitcherOutside, true);

        /*
         * On the window, in the capture phase: the grid's own navigation
         * listens on document in capture as well, and it was bound first --
         * so an arrow pressed with this menu open moved the cursor through the
         * bookmarks behind it and Enter opened one. The window sees the event
         * before the document does.
         */
        this._pageSwitcherKeys = (e) => this._handleSwitcherKey(e, menu);
        window.addEventListener('keydown', this._pageSwitcherKeys, true);

        const filterInput = menu.querySelector('.page-switcher-filter-input');
        if (filterInput) {
            filterInput.addEventListener('input', () => this._applySwitcherFilter(menu, filterInput.value));
        }
        /*
         * After the frame, because the click that opened this is not finished:
         * the browser focuses the button it was pressed on once the handler
         * returns, so anything focused here is focused and then let go of.
         */
        requestAnimationFrame(() => {
            if (this._pageSwitcherMenu !== menu) return;
            const target = filterInput
                || menu.querySelector('.page-switcher-item.is-current')
                || menu.querySelector('.page-switcher-item');
            target?.focus({ preventScroll: true });
        });
    }

    _escapeSwitcher(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    /** Rows the filter left standing, in the order they are drawn. */
    _switcherRows(menu) {
        return [...menu.querySelectorAll('.page-switcher-item')]
            .filter((row) => !row.hidden && row.offsetParent !== null);
    }

    _applySwitcherFilter(menu, term) {
        const needle = String(term || '').trim().toLowerCase();
        menu.querySelectorAll('.page-switcher-list .page-switcher-item').forEach((row) => {
            row.hidden = needle.length > 0 && !row.dataset.pageName.includes(needle);
        });
        this._positionPageTabPopover(menu, this._pageSwitcherAnchor);
    }

    _handleSwitcherKey(e, menu) {
        if (!this._pageSwitcherMenu) return;
        const rows = this._switcherRows(menu);
        const at = rows.indexOf(document.activeElement);
        // Everything below belongs to the menu while it is open; nothing behind
        // it may act on the same key.
        const mine = () => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        if (e.key === 'Escape') {
            mine();
            this.closePageSwitcherMenu({ focusAnchor: true });
            return;
        }
        if (e.key === 'Tab') {
            this.closePageSwitcherMenu();
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            mine();
            if (!rows.length) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            const next = at < 0
                ? (step > 0 ? 0 : rows.length - 1)
                : (at + step + rows.length) % rows.length;
            rows[next].focus({ preventScroll: true });
            return;
        }
        if (e.key === 'Home' || e.key === 'End') {
            if (!rows.length) return;
            mine();
            rows[e.key === 'Home' ? 0 : rows.length - 1].focus({ preventScroll: true });
            return;
        }

        /*
         * Enter and Space act on the row the keyboard is on. The button would
         * do that by itself, but the grid behind the menu answers Enter too,
         * and it is listening in the same phase.
         */
        if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
            mine();
            rows[at].click();
        }
    }

    /**
     * Add a page without leaving the menu.
     *
     * The same inline row the pages panel uses -- one implementation of "name
     * it, press enter" rather than a second one that drifts from it.
     */
    _openSwitcherCreateRow(menu, trigger) {
        const d = this.dash;
        if (!window.InlineCreateRow) {
            this.closePageSwitcherMenu();
            d.showPageOverlay?.();
            return;
        }
        const ui = window.InlineCreateRow.create({
            kind: 'page',
            placeholder: d.configLabel?.('newPageNamePlaceholder', 'Page name') || 'Page name',
            labels: {
                create: d.configLabel?.('create', 'Create') || 'Create',
                cancel: d.formatDashboardLabel('cancel', {}, 'Cancel'),
                group: d.formatDashboardLabel('pageOverviewNewPage', {}, 'New page'),
            },
        });
        ui.box.classList.add('page-switcher-create');
        trigger.hidden = true;
        menu.querySelector('.page-switcher-foot').insertBefore(ui.box, trigger);
        ui.box.hidden = false;
        this._positionPageTabPopover(menu, this._pageSwitcherAnchor);
        ui.input.focus({ preventScroll: true });

        window.InlineCreateRow.wire(ui, {
            submit: async (name) => {
                const created = await d.structureCreate.createPageFromForm(name);
                if (created.error) return created.error;
                this.closePageSwitcherMenu();
                await d.requestPageNavigation(created.id);
                return null;
            },
            onCancel: () => {
                ui.box.remove();
                trigger.hidden = false;
                trigger.focus({ preventScroll: true });
                this._positionPageTabPopover(menu, this._pageSwitcherAnchor);
            },
        });
    }

    /**
     * Anchor a popover under a control, for anyone outside this module.
     *
     * The placement rules -- below unless that runs off the bottom, nudged
     * back inside on both axes -- belong to no one control in particular, and
     * a second copy of them would drift from this one.
     */
    positionPopover(popover, anchorEl, options = {}) {
        return this._positionPageTabPopover(popover, anchorEl, options);
    }

    /**
     * Place a fixed popover fully inside the viewport, anchored to a page tab (or similar).
     */

    _positionPageTabPopover(popover, anchorEl, { initial = false } = {}) {
        const pad = 8;
        const gap = 6;
        if (initial) {
            popover.style.visibility = 'hidden';
        }
        popover.style.top = '0';
        popover.style.left = '0';
        popover.style.right = 'auto';
        popover.style.bottom = 'auto';

        const measure = () => {
            const anchor = anchorEl.getBoundingClientRect();
            const pop = popover.getBoundingClientRect();
            const maxLeft = Math.max(pad, window.innerWidth - pad - pop.width);
            const maxTop = Math.max(pad, window.innerHeight - pad - pop.height);

            let top = anchor.bottom + gap;
            let left = anchor.left;

            if (left + pop.width > window.innerWidth - pad) {
                left = anchor.right - pop.width;
            }
            left = Math.min(Math.max(pad, left), maxLeft);

            if (top + pop.height > window.innerHeight - pad) {
                const above = anchor.top - gap - pop.height;
                top = above >= pad ? above : maxTop;
            }
            top = Math.min(Math.max(pad, top), maxTop);

            popover.style.top = `${Math.round(top)}px`;
            popover.style.left = `${Math.round(left)}px`;
            if (initial) {
                popover.style.visibility = '';
            }
        };

        if (initial) {
            requestAnimationFrame(measure);
        } else {
            measure();
        }
    }


    _startPageTabRename(btn, page, index) {
        const d = this.dash;
        if (!this.allowsPageTabInlineEdit()) return;
        if (btn.querySelector('.page-tab-popover')) return;

        const PAGE_COLORS = [
            null,
            '#e05252', '#e08852', '#d4bf4a', '#4cac6b',
            '#5285e0', '#8b5fe0', '#e052a8', '#52c8e0'
        ];

        // Build popover
        const popover = document.createElement('div');
        popover.className = 'page-tab-popover';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'page-tab-popover-name';
        nameInput.value = page.name;
        nameInput.placeholder = d.configLabel('pageNamePlaceholder', 'Page name');

        const iconInput = document.createElement('input');
        iconInput.type = 'text';
        iconInput.className = 'page-tab-popover-icon';
        iconInput.value = page.icon || '';
        iconInput.placeholder = '📌';
        iconInput.maxLength = 4;

        const swatches = document.createElement('div');
        swatches.className = 'page-tab-color-swatches';
        PAGE_COLORS.forEach(color => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'page-tab-color-swatch' + (page.color === color ? ' selected' : '');
            sw.style.background = color || 'transparent';
            if (!color) sw.classList.add('swatch-none');
            sw.addEventListener('mousedown', (e) => {
                e.preventDefault();
                swatches.querySelectorAll('.page-tab-color-swatch').forEach(s => s.classList.remove('selected'));
                sw.classList.add('selected');
                page.color = color;
            });
            swatches.appendChild(sw);
        });

        const row = document.createElement('div');
        row.className = 'page-tab-popover-row';
        row.appendChild(iconInput);
        row.appendChild(nameInput);

        popover.appendChild(row);
        popover.appendChild(swatches);

        document.body.appendChild(popover);
        this._positionPageTabPopover(popover, btn, { initial: true });

        const reposition = () => {
            if (popover.isConnected) {
                this._positionPageTabPopover(popover, btn);
            }
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);

        const removeRepositionListeners = () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };

        nameInput.focus();
        nameInput.select();

        let done = false;
        const commit = async () => {
            if (done) return;
            done = true;
            removeRepositionListeners();
            popover.remove();
            const newName = nameInput.value.trim();
            const newIcon = iconInput.value.trim();
            if (!newName) { this._renderPageTabContent(btn, page, index); return; }
            const previousName = page.name;
            const previousIcon = page.icon;
            page.name = newName;
            page.icon = newIcon || undefined;
            this._renderPageTabContent(btn, page, index);
            this.updatePageTitle(newName);
            try {
                const response = await dashFetch('/api/pages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(d.pages)
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                page.name = previousName;
                page.icon = previousIcon;
                this._renderPageTabContent(btn, page, index);
                this.updatePageTitle(previousName || '');
                const message = d.formatDashboardLabel(
                    'savePageFailed',
                    {},
                    'Failed to save page.'
                );
                const detail = error?.message ? `${message} ${error.message}` : message;
                d.showErrorNotification(detail);
            }
        };
        const cancel = () => {
            if (done) return;
            done = true;
            removeRepositionListeners();
            popover.remove();
            this._renderPageTabContent(btn, page, index);
            btn.focus({ preventScroll: true });
        };

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        iconInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameInput.focus(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });

        // Close on outside click
        const onOutside = (e) => {
            if (!popover.contains(e.target) && e.target !== btn) {
                document.removeEventListener('mousedown', onOutside);
                commit();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
    }


    async consumeDashboardDeepLink() {
        const d = this.dash;
        if (typeof DashboardDeepLink === 'undefined') return;
        const link = DashboardDeepLink.parseDashboardDeepLink();
        if (!DashboardDeepLink.hasDeepLinkTarget(link)) return;

        if (link.pageId != null && d.pages.some((p) => d.samePageId(p.id, link.pageId))) {
            if (!d.samePageId(d.currentPageId, link.pageId)) {
                await this.requestPageNavigation(link.pageId);
            }
        }

        // Wait for the grid to actually hold the target rather than guessing at
        // two frames. Two was enough on a small collection and not enough on a
        // large one, where the rows this link points at had not been rendered
        // yet — so expandCategoryForDeepLink found nothing and announced that
        // the category had been deleted, about a category sitting in plain
        // sight on the same page.
        await this.waitForDeepLinkTarget(link);
        this.focusDashboardDeepLinkTarget(link);
    }

    /**
     * Resolve once the deep link's target exists in the DOM, or give up.
     *
     * Polls per animation frame up to a deadline. The deadline matters as much
     * as the wait: a link can legitimately point at a category that really was
     * deleted, and that case has to end in the message rather than hanging.
     * Returns whether the target was found, so the caller can tell "not there
     * yet" apart from "not there at all".
     */
    waitForDeepLinkTarget(link, timeoutMs = 2000) {
        if (!link) return Promise.resolve(false);
        const present = () => {
            // A category link is satisfied by its category; a bookmark-only
            // link by its row. Either is enough to stop waiting.
            if (link.categoryId) {
                const escaped = typeof CSS !== 'undefined' && CSS.escape
                    ? CSS.escape(link.categoryId)
                    : String(link.categoryId).replace(/["\\]/g, '\\$&');
                if (document.querySelector(`.category[data-category-id="${escaped}"]`)) return true;
            }
            return Boolean(this.findBookmarkRowForDeepLink(link));
        };

        return new Promise((resolve) => {
            if (present()) {
                resolve(true);
                return;
            }
            const deadline = Date.now() + timeoutMs;
            const tick = () => {
                if (present()) {
                    resolve(true);
                    return;
                }
                if (Date.now() >= deadline) {
                    resolve(false);
                    return;
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }


    expandCategoryForDeepLink(categoryId) {
        const d = this.dash;
        if (!categoryId) return null;
        const escaped = typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(categoryId)
            : String(categoryId).replace(/["\\]/g, '\\$&');
        const catEl = document.querySelector(
            `.category[data-category-id="${escaped}"]:not([data-smart-collection="true"])`
        );
        if (!catEl) return null;
        const collapsedKey = `${d.currentPageId}:${categoryId}`;
        catEl.setAttribute('data-collapsed', 'false');
        d.collapsedCategories[collapsedKey] = false;
        if (categoryId in d.collapsedCategories) {
            delete d.collapsedCategories[categoryId];
        }
        d.saveCollapsedStates();
        return catEl;
    }


    findBookmarkRowForDeepLink(link) {
        if (!link) return null;
        if (link.bookmarkIndex != null && link.bookmarkIndex >= 0) {
            const byIndex = document.querySelector(
                `.bookmark-link[data-bookmark-index="${link.bookmarkIndex}"]`
            );
            if (byIndex) return byIndex;
        }
        if (!link.url) return null;
        const targetUrl = String(link.url).trim();
        const canonical = typeof BookmarkUrlUtils !== 'undefined'
            ? BookmarkUrlUtils.canonicalBookmarkURLKey(targetUrl)
            : targetUrl.toLowerCase();
        const rows = document.querySelectorAll('.bookmark-link[data-bookmark-url]');
        for (const row of rows) {
            const rowUrl = String(row.getAttribute('data-bookmark-url') || '').trim();
            if (!rowUrl) continue;
            const rowKey = typeof BookmarkUrlUtils !== 'undefined'
                ? BookmarkUrlUtils.canonicalBookmarkURLKey(rowUrl)
                : rowUrl.toLowerCase();
            if (rowKey === canonical) return row;
        }
        return null;
    }


    focusDashboardDeepLinkTarget(link) {
        const d = this.dash;
        if (!link) return false;

        if (link.categoryId) {
            const catEl = this.expandCategoryForDeepLink(link.categoryId);
            if (catEl) {
                catEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else if (!this.findBookmarkRowForDeepLink(link)) {
                // Only when the bookmark is missing too. A row that is on the
                // page while its category element is not means the grid is
                // showing it some other way — a tag filter, a smart
                // collection — and the link has done its job, so saying the
                // category was deleted would be wrong and alarming.
                //
                // this.t() rather than language.t(): the latter returns the
                // key itself when a string is missing, and a non-empty string
                // is truthy, so the `|| 'Category not found…'` fallback this
                // used to carry could never fire — which is how the toast came
                // to read "dashboard.deepLinkCategoryNotFound". The helper a
                // few methods up already compares against the key; these two
                // were the only call sites not using it.
                d.showNotification(
                    this.t(
                        'dashboard.deepLinkCategoryNotFound',
                        'Category not found — it may have been deleted. Showing all bookmarks.'
                    ),
                    'info',
                    { duration: 6000 }
                );
            }
        }

        const row = this.findBookmarkRowForDeepLink(link);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.remove('bookmark-deep-link-focus');
            void row.offsetWidth;
            row.classList.add('bookmark-deep-link-focus');
            row.addEventListener(
                'animationend',
                () => row.classList.remove('bookmark-deep-link-focus'),
                { once: true }
            );
            if (d.keyboardNavigation?.navigableElements) {
                d.keyboardNavigation.updateNavigableElements?.();
                const navIdx = d.keyboardNavigation.navigableElements.indexOf(row);
                if (navIdx >= 0) {
                    d.keyboardNavigation.currentIndex = navIdx;
                    d.keyboardNavigation.highlightCurrentElement?.();
                }
            }
            // ?edit=1 lands on the row and opens the inline editor. tryOpenInlineBookmarkEdit
            // resolves the bookmark from the keyboard-nav current element set just above.
            if (link.edit && typeof d.tryOpenInlineBookmarkEdit === 'function') {
                requestAnimationFrame(() => d.tryOpenInlineBookmarkEdit());
            }
        } else if (link.bookmarkIndex != null || link.url) {
            // Same fallback bug as the category message above: t() answers with
            // the key when a string is missing, so `|| '…'` never ran.
            d.showNotification(
                this.t(
                    'dashboard.deepLinkBookmarkNotFound',
                    'Bookmark not found on this page (it may have moved).'
                ),
                'info',
                { duration: 4000 }
            );
        }

        DashboardDeepLink.stripDeepLinkParams();
        return Boolean(row);
    }

}

window.DashboardPageNav = DashboardPageNav;
