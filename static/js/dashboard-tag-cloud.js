/**
 * Dashboard tag word cloud — / FAB opens a modal; selecting a tag filters dashboard tiles.
 */
(function () {
    'use strict';

    function t(key, fallback) {
        const lang = window.dashboardInstance?.language;
        if (lang?.t) {
            const v = lang.t(key);
            if (v && v !== key) return v;
        }
        return fallback;
    }

    function isMobileLayout() {
        return window.MobileExperience?.isMobileLayout?.() === true;
    }

    const Model = () => window.TagCloudModel;

    // What the cloud looks like with tags in it, for a library that has none
    // yet: shown once, from the quick start, and never counted as the reader's.
    const DEMO_TAGS = [
        ['docs', 14], ['homelab', 12], ['media', 10], ['dev', 9], ['news', 7],
        ['tools', 6], ['music', 5], ['read-later', 4], ['games', 3], ['recipes', 2],
    ];

    function countTagsFromBookmarks(bookmarks) {
        return Model().countTags(bookmarks);
    }

    const DashboardTagCloud = {
        wrap: null,
        modal: null,
        backdrop: null,
        body: null,
        toggle: null,
        closeBtn: null,
        clearBtn: null,
        modalOpen: false,
        // True while the example cloud is open: its words are not the
        // reader's tags, so they pick nothing.
        _demo: false,
        activeTags: [],
        _kbdFocusIndex: 0,
        _kbdFocusZone: 'chip',
        _initialized: false,
        _boundResize: null,
        _closeTimerId: null,
        _boundToggleClick: null,
        _boundCloseClick: null,
        _boundBackdropClick: null,
        _boundClearClick: null,
        _boundClearFocus: null,

        init() {
            if (this._initialized) return;
            this.wrap = document.getElementById('dashboard-tag-cloud-wrap');
            this.modal = document.getElementById('tag-cloud-modal');
            this.backdrop = document.getElementById('tag-cloud-modal-backdrop');
            this.body = document.getElementById('tag-cloud-modal-body');
            this.toggle = document.getElementById('tag-cloud-toggle-btn');
            this.closeBtn = document.getElementById('tag-cloud-modal-close');
            this.clearBtn = document.getElementById('tag-cloud-clear-filter');
            if (!this.wrap || !this.modal || !this.body || !this.toggle) return;

            this._boundToggleClick = () => this.onToggleClick();
            this._boundCloseClick = () => this.closeModal();
            this._boundBackdropClick = () => this.closeModal();
            this._boundClearClick = () => {
                this.clearDashboardFilter({ closeModal: true, focusBookmarks: true });
            };
            this._boundClearFocus = () => {
                this._kbdFocusZone = 'clear';
                this.getTagChips().forEach((el) => el.classList.remove('is-keyboard-focused'));
                this.clearBtn?.classList.add('is-keyboard-focused');
            };

            this.toggle.addEventListener('click', this._boundToggleClick);
            this.closeBtn?.addEventListener('click', this._boundCloseClick);
            this.backdrop?.addEventListener('click', this._boundBackdropClick);
            this.clearBtn?.addEventListener('click', this._boundClearClick);
            this.clearBtn?.addEventListener('focus', this._boundClearFocus);
            window.addEventListener('resize', this._boundResize = () => {
                if (this.modalOpen) this.positionModal();
                this.syncFromSettings();
            });

            this._boundModalKeydown = (e) => this.handleModalKeydown(e);
            document.addEventListener('keydown', this._boundModalKeydown, true);

            this.syncFromSettings();
            this._initialized = true;
        },

        destroy() {
            if (!this._initialized) return;
            if (this._closeTimerId) {
                clearTimeout(this._closeTimerId);
                this._closeTimerId = null;
            }
            if (this._boundModalKeydown) {
                document.removeEventListener('keydown', this._boundModalKeydown, true);
                this._boundModalKeydown = null;
            }
            if (this._boundResize) {
                window.removeEventListener('resize', this._boundResize);
                this._boundResize = null;
            }
            this.toggle?.removeEventListener('click', this._boundToggleClick);
            this.closeBtn?.removeEventListener('click', this._boundCloseClick);
            this.backdrop?.removeEventListener('click', this._boundBackdropClick);
            this.clearBtn?.removeEventListener('click', this._boundClearClick);
            this.clearBtn?.removeEventListener('focus', this._boundClearFocus);
            this._boundToggleClick = null;
            this._boundCloseClick = null;
            this._boundBackdropClick = null;
            this._boundClearClick = null;
            this._boundClearFocus = null;
            this.closeModal({ animate: false });
            this._initialized = false;
        },

        normalizeActiveTags(tags = this.activeTags) {
            const dash = window.dashboardInstance;
            if (dash?.normalizeTagFilters) {
                return dash.normalizeTagFilters(tags);
            }
            const list = Array.isArray(tags) ? tags : [];
            return list
                .map((tag) => String(tag || '').trim().toLowerCase())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        },

        isTagActive(tag) {
            const normalized = String(tag || '').trim().toLowerCase();
            return this.normalizeActiveTags().includes(normalized);
        },

        syncActiveTagsFromDashboard() {
            const dash = window.dashboardInstance;
            this.activeTags = dash?.normalizeTagFilters
                ? dash.normalizeTagFilters(dash._tagFilters || [])
                : this.normalizeActiveTags();
        },

        updateChipSelection() {
            const active = new Set(this.normalizeActiveTags());
            this.getTagChips().forEach((chip) => {
                const tag = chip.dataset.tag || '';
                const selected = active.has(tag);
                chip.classList.toggle('is-selected', selected);
                chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
            });
            this.refreshChipCounts();
        },

        /**
         * The figure beside each word, and the one in the header.
         *
         * With nothing filtering, a tag's figure is how many bookmarks carry it.
         * With a filter on it is what the tag would add -- bookmarks carrying it
         * that are not in the result yet -- so a tag that adds nothing says +0
         * and dims. A tag that is filtering keeps its own total.
         */
        refreshChipCounts() {
            const chips = this.getTagChips();
            if (this._demo) {
                const counts = new Map(DEMO_TAGS);
                chips.forEach((chip) => {
                    const total = counts.get(chip.dataset.tag || '') || 0;
                    const countEl = chip.querySelector('.tag-cloud-word-count');
                    if (countEl) countEl.textContent = String(total);
                    chip.title = `${chip.dataset.tag} — ${this.getTagCountLabel(total)}`;
                });
                this.updateHeaderCount(chips.length, 0);
                return;
            }
            const active = this.normalizeActiveTags();
            const pool = this.getBookmarkPool();
            const totals = new Map(Model().countTags(pool).map(({ tag, count }) => [tag, count]));
            const plus = Model().plusCounts(pool, active);
            chips.forEach((chip) => {
                const tag = chip.dataset.tag || '';
                const total = totals.get(tag) || 0;
                const adding = active.length > 0 && !active.includes(tag);
                const adds = plus.get(tag) || 0;
                const countEl = chip.querySelector('.tag-cloud-word-count');
                if (countEl) countEl.textContent = adding ? `+${adds}` : String(total);
                chip.classList.toggle('is-zero', adding && adds === 0);
                const countLabel = this.getTagCountLabel(total);
                chip.title = adding
                    ? `${tag} — ${countLabel}, ${t('dashboard.tagCloudAdds', 'adds {count}').replace('{count}', String(adds))}`
                    : `${tag} — ${countLabel}`;
            });
            this.updateHeaderCount(chips.length, active.length);
        },

        updateHeaderCount(total, active = this.normalizeActiveTags().length) {
            const el = document.getElementById('tag-cloud-modal-count');
            if (!el) return;
            if (!total) {
                el.textContent = '';
                return;
            }
            const figure = active
                ? t('dashboard.tagCloudCountOf', '{active} of {total}')
                    .replace('{active}', String(active))
                    .replace('{total}', String(total))
                : String(total);
            el.textContent = `· ${figure}`;
        },

        formatActiveTagsLabel() {
            const tags = this.normalizeActiveTags();
            const dash = window.dashboardInstance;
            if (dash?.formatTagFilterTagsLabel) {
                return dash.formatTagFilterTagsLabel(tags);
            }
            return tags.map((tag) => `#${tag}`).join(', ');
        },

        getTagChips() {
            if (!this.body) return [];
            return [...this.body.querySelectorAll('.tag-cloud-word')];
        },

        /** The chips the arrows may land on: every one, or those matching what is typed. */
        getNavigableChips() {
            return this.getTagChips().filter((chip) => !chip.classList.contains('is-miss'));
        },

        /**
         * Narrow the cloud to what is typed.
         *
         * Non-matching tags dim in place rather than leave, so the cloud does
         * not reflow under the reader's eye, and the first match takes the
         * focus so Enter picks it.
         */
        applyQuery() {
            const query = this._query || '';
            const chips = this.getTagChips();
            chips.forEach((chip) => {
                const miss = Boolean(query) && Model().matchQuery(chip.dataset.tag || '', query) < 0;
                chip.classList.toggle('is-miss', miss);
            });
            const label = document.getElementById('tag-cloud-modal-query');
            if (label) {
                label.hidden = !query;
                label.textContent = query ? `"${query}"` : '';
            }
            if (!query) return;
            const navigable = this.getNavigableChips();
            if (navigable.length) this.focusChipAtIndex(0, navigable);
        },

        setQuery(next) {
            this._query = String(next || '').toLowerCase();
            this.applyQuery();
        },

        isClearButtonFocusable() {
            return Boolean(this.clearBtn && !this.clearBtn.hidden);
        },

        isFocusOnClearButton() {
            return Boolean(this.clearBtn && document.activeElement === this.clearBtn);
        },

        focusClearButton() {
            if (!this.isClearButtonFocusable()) return;
            this._kbdFocusZone = 'clear';
            this.getTagChips().forEach((el) => el.classList.remove('is-keyboard-focused'));
            this.clearBtn.classList.add('is-keyboard-focused');
            this.clearBtn.focus({ preventScroll: true });
            this.clearBtn.scrollIntoView({ block: 'nearest' });
        },

        getFocusedChipIndex(chips = this.getTagChips()) {
            if (!chips.length) return -1;
            const active = document.activeElement;
            const idx = chips.indexOf(active);
            if (idx >= 0) return idx;
            if (this._kbdFocusIndex >= 0 && this._kbdFocusIndex < chips.length) {
                return this._kbdFocusIndex;
            }
            return 0;
        },

        focusChipAtIndex(index, chips = this.getTagChips()) {
            if (!chips.length) return;
            const i = ((index % chips.length) + chips.length) % chips.length;
            this._kbdFocusIndex = i;
            this._kbdFocusZone = 'chip';
            this.clearBtn?.classList.remove('is-keyboard-focused');
            const chip = chips[i];
            chip.classList.add('is-keyboard-focused');
            chips.forEach((el, j) => {
                if (j !== i) el.classList.remove('is-keyboard-focused');
            });
            chip.focus({ preventScroll: true });
            chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        },

        moveModalFocus(direction) {
            if (this.isFocusOnClearButton()) {
                const chips = this.getNavigableChips();
                if (!chips.length) return;
                if (direction === 'up' || direction === 'left') {
                    this.focusChipAtIndex(this._kbdFocusIndex, chips);
                } else if (direction === 'down' || direction === 'right') {
                    this.focusChipAtIndex(0, chips);
                }
                return;
            }

            const chips = this.getNavigableChips();
            if (!chips.length) {
                if (this.isClearButtonFocusable()) this.focusClearButton();
                return;
            }

            /*
             * Linear, like a dashboard list: every arrow walks the cloud in
             * reading order. Jumping to whichever chip sits nearest in the
             * arrow's direction looked clever but landed somewhere new each
             * time the word sizes shifted the rows.
             */
            const currentIdx = this.getFocusedChipIndex(chips);
            const delta = direction === 'right' || direction === 'down' ? 1 : -1;
            const next = currentIdx + delta;
            if (next >= chips.length && this.isClearButtonFocusable()) {
                this.focusClearButton();
                return;
            }
            this.focusChipAtIndex(next, chips);
        },

        focusInitialChip() {
            const chips = this.getTagChips();
            if (!chips.length) {
                this.closeBtn?.focus?.();
                return;
            }
            let idx = 0;
            if (this.activeTags.length) {
                const active = new Set(this.normalizeActiveTags());
                const match = chips.findIndex(
                    (el) => active.has(el.dataset.tag || '')
                );
                if (match >= 0) idx = match;
            }
            requestAnimationFrame(() => {
                requestAnimationFrame(() => this.focusChipAtIndex(idx, chips));
            });
        },

        handleModalKeydown(e) {
            if (!this.modalOpen) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

            const swallow = () => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            };

            // The typing first, then the cloud.
            if (e.key === 'Escape') {
                swallow();
                if (this._query) {
                    this.setQuery('');
                    return;
                }
                this.closeModal();
                return;
            }

            if (e.key === 'Backspace' && this._query) {
                swallow();
                this.setQuery(this._query.slice(0, -1));
                return;
            }

            if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[a-z0-9-]$/i.test(e.key)) {
                swallow();
                this.setQuery(`${this._query || ''}${e.key}`);
                return;
            }

            if (e.key === 'Tab' && this.modal) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                window.FocusTrapUtils?.trapTabKey(e, this.modal);
                return;
            }

            if (e.key === 'Enter' || e.key === ' ') {
                const active = document.activeElement;
                if (active?.classList?.contains('tag-cloud-word')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const tag = active.dataset.tag;
                    if (tag) this.selectTag(tag, { stack: e.shiftKey });
                    return;
                }
                if (active === this.closeBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.closeModal();
                    return;
                }
                if (active === this.clearBtn && this.isClearButtonFocusable()) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.clearDashboardFilter({ closeModal: true, focusBookmarks: true });
                    return;
                }
            }

            const chips = this.getTagChips();
            if (!chips.length && !this.isClearButtonFocusable()) return;

            const arrowMap = {
                ArrowLeft: 'left',
                ArrowRight: 'right',
                ArrowUp: 'up',
                ArrowDown: 'down',
            };
            const spatialDir = arrowMap[e.key];
            if (spatialDir) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.moveModalFocus(spatialDir);
                return;
            }

            if (e.key === 'Home') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const navigable = this.getNavigableChips();
                if (navigable.length) this.focusChipAtIndex(0, navigable);
                else if (this.isClearButtonFocusable()) this.focusClearButton();
                return;
            }

            if (e.key === 'End') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const navigable = this.getNavigableChips();
                if (this.isClearButtonFocusable()) this.focusClearButton();
                else if (navigable.length) this.focusChipAtIndex(navigable.length - 1, navigable);
            }
        },

        getBookmarkPool() {
            const dash = window.dashboardInstance;
            if (!dash) return [];
            /*
             * The page on screen from its own list, every other page from the
             * cross-page one. The current page's rows are the ones edits land
             * in first, so they win over their copies in allBookmarks; the
             * filter view reads this same pool, which is what lets a tag that
             * lives on another page show its bookmarks instead of an empty grid.
             */
            const current = Array.isArray(dash.bookmarks) ? dash.bookmarks : [];
            const currentId = Number(dash.currentPageId);
            const others = (Array.isArray(dash.allBookmarks) ? dash.allBookmarks : [])
                .filter((bookmark) => Number(bookmark?.pageId ?? bookmark?.pageID) !== currentId);
            const pool = [...current, ...others];
            // Kept bookmarks carry tags of their own and are tagged from their
            // own view, but they are not filed yet -- listing their tags here
            // would put a route to them on the dashboard, which is the one
            // place they stay out of until they have a category.
            return window.UnsortedPage?.without?.(pool) ?? pool;
        },

        /**
         * Whether the button is drawn. Chrome, and nothing more.
         *
         * This used to gate the whole feature, so switching the button off took
         * the tag cloud with it and `/` had nothing left to open — which is why
         * the key fell back to the search panel's tag mode. A setting about
         * whether a button is on screen should not decide whether a keyboard
         * shortcut works.
         */
        isButtonShownInSettings() {
            return window.dashboardInstance?.settings?.showTagCloudButton === true;
        },

        libraryHasTags() {
            return countTagsFromBookmarks(this.getBookmarkPool()).length > 0;
        },

        /**
         * Can this library use the tag cloud at all?
         *
         * Deliberately view-blind, and deliberately blind to the button: having
         * no tags left or a phone-sized window means the filter has nowhere to
         * live, so an active one is dropped. Standing in another view is not
         * that — the filter is still on the bookmarks grid you came from and is
         * still on the grid you go back to — and neither is hiding the button,
         * which only takes the button away.
         */
        isFeatureAvailable() {
            return this.libraryHasTags() && !isMobileLayout();
        },

        isEligible() {
            // The cloud picks tags for the grid and for the tag view, so it has
            // nothing to do in the other views -- gated here, at the source,
            // rather than at each caller (the toggle button's own CSS and
            // handleSlashKey both read this one answer).
            const dash = window.dashboardInstance;
            // The tag view is a filter's own page: the cloud changes its tags there.
            return this.isFeatureAvailable() && (!dash || dash.isBookmarksView() || dash.activeView === 'tags');
        },

        syncFromSettings() {
            if (!this.wrap) return;

            const eligible = this.isEligible();
            // The button is drawn only when it is both usable and asked for;
            // the feature itself no longer depends on that second half.
            const buttonShown = eligible && this.isButtonShownInSettings();
            this.wrap.classList.toggle('is-eligible', buttonShown);
            this.toggle?.classList.toggle('is-eligible', buttonShown);
            document.body.setAttribute(
                'data-show-tag-cloud-button',
                this.isButtonShownInSettings() ? 'true' : 'false'
            );

            if (!eligible) {
                this.closeModal({ animate: false });
                /*
                 * The cloud is a desktop thing; the tag view is not. A phone
                 * (or a library still loading, which reads as "no tags")
                 * makes the cloud ineligible, and clearing the filter then
                 * closed a tag view opened from a link or :filter. The view
                 * owns its tags while it is open.
                 */
                if (!this.isFeatureAvailable() && window.dashboardInstance?.activeView !== 'tags') {
                    this.clearDashboardFilter({ animate: false });
                }
                return;
            }

            this.syncToggleState();
            window.dashboardInstance?.syncTagCloudButtonPlacement?.();
        },

        syncToggleState() {
            if (!this.toggle) return;
            const tags = this.normalizeActiveTags();
            const filtered = tags.length > 0;
            this.toggle.classList.toggle('is-active', this.modalOpen || filtered);
            this.toggle.setAttribute('aria-expanded', this.modalOpen ? 'true' : 'false');
            document.body.setAttribute('data-tag-cloud-modal-open', this.modalOpen ? 'true' : 'false');
            document.body.setAttribute('data-tag-filter-active', filtered ? 'true' : 'false');
            // Active filters are shown in the tag-filter banner; avoid a second "Filtering:" chip on the FAB.
            this.toggle.removeAttribute('data-tooltip');
            this.toggle.removeAttribute('title');
        },

        onToggleClick() {
            // The button rides the header, which stands over every view, while
            // the cloud filters the grid. Pressed from config, health or inbox
            // it takes you back to the page it acts on and opens there.
            const dash = window.dashboardInstance;
            if (this.isFeatureAvailable() && dash && !dash.isBookmarksView() && dash.activeView !== 'tags') {
                void Promise.resolve(dash.requestPageNavigation(dash.currentPageId))
                    .then(() => {
                        this.syncFromSettings();
                        this.openModal();
                    });
                return;
            }
            if (!this.isEligible()) return;
            if (this.modalOpen) {
                this.closeModal();
            } else {
                this.openModal();
            }
        },

        /**
         * The example cloud, for someone with no tags yet: ten made-up words so
         * the shape of the thing is there to look at, and a way into the Tags
         * view. Resolves to false where there is no cloud to show (a phone).
         */
        openDemo({ onClose } = {}) {
            if (!this.modal || !this.body || isMobileLayout()) return false;
            this._demo = true;
            this._onDemoClose = typeof onClose === 'function' ? onClose : null;
            this.openModal({ demo: true });
            return this.modalOpen;
        },

        openModal({ demo = false } = {}) {
            if (!demo && !this.isEligible()) return;
            if (!this.modal) return;
            /*
             * The wrap is what carries the cloud, and it is hidden until it is
             * told it is eligible.
             *
             * The class that shows it is written by syncFromSettings, which
             * runs when the setting changes and on a view switch -- so a cloud
             * opened in the same tick the setting was turned on drew itself
             * inside a `display: none` parent: a modal that is open, has its
             * tags in it, answers the keyboard, and is nowhere on screen.
             * Asked here as well, where it costs one class toggle.
             */
            if (demo) {
                // Not eligible, so the wrap is shown by hand for as long as the
                // example is up; closing hands it back to syncFromSettings.
                this.wrap?.classList.add('is-eligible');
            } else {
                this._demo = false;
                this.syncFromSettings();
            }
            window.nextdashTrack?.('modal:tag-cloud', demo ? { example: true } : undefined);
            if (this._closeTimerId) {
                clearTimeout(this._closeTimerId);
                this._closeTimerId = null;
            }
            if (!demo) this.syncActiveTagsFromDashboard();
            this.renderWordCloud();
            this.playEntrance();
            if (!demo) this.ensureEveryPageLoaded();
            this.updateClearButton();
            // The × is not a name. The template carries an English label; this
            // keeps it in the current language when the language changed later.
            this.closeBtn?.setAttribute('aria-label', t('dashboard.tagCloudModalClose', 'Close'));
            this.modal.hidden = false;
            this.modal.setAttribute('aria-hidden', 'false');
            this.backdrop?.removeAttribute('hidden');
            this.backdrop?.setAttribute('aria-hidden', 'false');
            this.modalOpen = true;
            this.positionModal();
            requestAnimationFrame(() => {
                this.modal?.classList.add('is-open');
                this.backdrop?.classList.add('is-open');
                requestAnimationFrame(() => {
                    this.positionModal();
                });
            });
            this.syncToggleState();
            window.dashboardInstance?.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
            window.FocusTrapUtils?.syncDashboardInert?.();
            window.dashboardInstance?.language?.applyTranslations?.();
            this.focusInitialChip();
        },

        /**
         * The cloud and its filter are about the whole library, and startup
         * skips loading other pages when no setting asks for them -- which is
         * the case for `/` with the header button switched off. Fetched here,
         * once, and the cloud and an active filter redrawn when it lands.
         */
        ensureEveryPageLoaded() {
            const dash = window.dashboardInstance;
            if (!dash || dash._unsortedLoaded || !dash.data?.deferredLoadAllBookmarks) return;
            void dash.data.deferredLoadAllBookmarks().then(() => {
                if (this.modalOpen) this.renderWordCloud();
                if (dash.hasActiveTagFilters?.()) dash.renderDashboard?.({ animate: false });
            }).catch(() => {});
        },

        restoreBookmarkFocus() {
            const run = () => {
                const kn = window.dashboardInstance?.keyboardNavigation;
                if (kn) {
                    kn.updateNavigableElements();
                    if (kn.navigableElements.length === 0) {
                        kn.currentIndex = -1;
                        return;
                    }
                    if (kn.currentIndex < 0 || kn.currentIndex >= kn.navigableElements.length) {
                        kn.currentIndex = 0;
                    }
                    kn.highlightCurrentElement();
                    return;
                }
                const link = document.querySelector(
                    '#dashboard-layout .bookmark-link a.bookmark-open'
                );
                link?.focus?.({ preventScroll: true });
            };
            requestAnimationFrame(() => requestAnimationFrame(run));
        },

        closeModal({ animate = true, focusBookmarks = false } = {}) {
            if (!this.modal) return;
            const finish = () => {
                this.modal.classList.remove('is-open');
                this.backdrop?.classList.remove('is-open');
                this.modal.hidden = true;
                this.modal.setAttribute('aria-hidden', 'true');
                this.backdrop?.setAttribute('hidden', '');
                this.backdrop?.setAttribute('aria-hidden', 'true');
                this.modalOpen = false;
                if (this._demo) {
                    this._demo = false;
                    // The example's words and its note go with it.
                    this.body?.replaceChildren();
                    this.syncFromSettings();
                    const afterDemo = this._onDemoClose;
                    this._onDemoClose = null;
                    afterDemo?.();
                }
                this._kbdFocusZone = 'chip';
                this.clearBtn?.classList.remove('is-keyboard-focused');
                this.syncToggleState();
                window.FocusTrapUtils?.syncDashboardInert?.();
                if (focusBookmarks) {
                    this.restoreBookmarkFocus();
                } else if (document.activeElement?.closest?.('#tag-cloud-modal')) {
                    // The grid is where the reader was, and the button in the
                    // bar is not: sending the focus back up there leaves a
                    // lit control behind and costs a walk back down.
                    const kn = window.dashboardInstance?.keyboardNavigation;
                    document.activeElement.blur?.();
                    if (!kn?.focusRowAfterOverlay?.(kn.currentIndex)) {
                        this.toggle?.focus?.();
                    }
                }
            };
            if (!animate || !this.modalOpen) {
                finish();
                return;
            }
            this.modal.classList.remove('is-open');
            this.backdrop?.classList.remove('is-open');
            if (this._closeTimerId) {
                clearTimeout(this._closeTimerId);
            }
            this._closeTimerId = window.setTimeout(() => {
                this._closeTimerId = null;
                finish();
            }, 180);
        },

        measureModalNaturalHeight() {
            const header = this.modal?.querySelector('.tag-cloud-modal-header');
            const footer = this.modal?.querySelector('.tag-cloud-modal-footer');
            const headerH = header?.offsetHeight || 0;
            const footerH = footer?.hidden ? 0 : (footer?.offsetHeight || 0);
            return headerH + (this.body?.scrollHeight || 0) + footerH;
        },

        syncModalSize(maxHeight) {
            if (!this.modal || !this.body) return;

            this.modal.style.height = 'auto';
            this.modal.style.maxHeight = 'none';
            this.body.style.maxHeight = 'none';
            this.body.classList.remove('is-scrollable');

            const naturalH = this.measureModalNaturalHeight();
            const cap = Math.max(120, maxHeight);
            this.modal.style.maxHeight = `${cap}px`;
            this.modal.style.setProperty('--tag-cloud-modal-max-height', `${cap}px`);

            if (naturalH <= cap + 1) {
                this.modal.style.height = 'auto';
                return;
            }

            const header = this.modal.querySelector('.tag-cloud-modal-header');
            const footer = this.modal.querySelector('.tag-cloud-modal-footer');
            const headerH = header?.offsetHeight || 0;
            const footerH = footer?.hidden ? 0 : (footer?.offsetHeight || 0);
            const bodyMax = Math.max(80, cap - headerH - footerH);

            this.modal.style.height = `${cap}px`;
            this.body.style.maxHeight = `${bodyMax}px`;
            this.body.classList.add('is-scrollable');
        },

        /**
         * The part of the window the cloud may use: all of it, less the action
         * bar and a margin around it.
         *
         * The cloud used to hang from its button, and with the button in the
         * bar that put it over the bar -- and for a bar docked to the bottom or
         * a side, half off the page. It is a panel of its own now, so it only
         * has to keep out of the bar's way.
         */
        availableArea(margin) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const area = { top: margin, left: margin, right: vw - margin, bottom: vh - margin };
            const bar = this.toggle?.closest('.header-shortcuts') || document.querySelector('.header-shortcuts');
            const r = bar?.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
                if (r.width >= r.height) {
                    if (r.top + r.height / 2 < vh / 2) area.top = Math.max(area.top, r.bottom + margin);
                    else area.bottom = Math.min(area.bottom, r.top - margin);
                } else if (r.left + r.width / 2 < vw / 2) {
                    area.left = Math.max(area.left, r.right + margin);
                } else {
                    area.right = Math.min(area.right, r.left - margin);
                }
            }
            return area;
        },

        /** Centred in what the window leaves it, a little above the middle. */
        positionModal() {
            if (!this.modal) return;
            const margin = 16;
            const area = this.availableArea(margin);
            const areaW = Math.max(240, area.right - area.left);
            const areaH = Math.max(160, area.bottom - area.top);

            const tagCount = this.body?.querySelectorAll('.tag-cloud-word').length || 0;
            const idealW = 360 + Math.sqrt(tagCount) * 46;
            const width = Math.min(Math.max(idealW, 320), 720, areaW);
            this.modal.style.width = `${Math.round(width)}px`;
            this.modal.style.maxWidth = `${Math.round(width)}px`;

            this.syncModalSize(Math.min(areaH, Math.round(window.innerHeight * 0.8)));
            const height = this.modal.offsetHeight || 240;
            const left = area.left + (areaW - width) / 2;
            const top = area.top + Math.max(0, (areaH - height) * 0.42);

            this.modal.style.left = `${Math.round(left)}px`;
            this.modal.style.right = 'auto';
            this.modal.style.top = `${Math.round(top)}px`;
            this.modal.style.bottom = 'auto';
        },

        getTagCountLabel(count) {
            const dash = window.dashboardInstance;
            if (dash?.formatTagFilterCountLabel) {
                return dash.formatTagFilterCountLabel(count);
            }
            if (count === 1) {
                return t('dashboard.tagFilterCountOne', '1 bookmark');
            }
            return (t('dashboard.tagFilterCountMany', '{count} bookmarks') || '{count} bookmarks')
                .replace('{count}', String(count));
        },

        renderWordCloud() {
            if (!this.body) return;
            this._query = '';
            const queryLabel = document.getElementById('tag-cloud-modal-query');
            if (queryLabel) {
                queryLabel.hidden = true;
                queryLabel.textContent = '';
            }
            const pool = this.getBookmarkPool();
            const ranked = this._demo
                ? DEMO_TAGS.map(([tag, count]) => ({ tag, count }))
                : Model().countTags(pool);

            this.body.replaceChildren();
            if (!ranked.length) {
                this.updateHeaderCount(0);
                const empty = document.createElement('p');
                empty.className = 'tag-cloud-modal-empty';
                empty.textContent = t('dashboard.tagCloudEmpty', 'No tags yet — add tags in config → bookmarks.');
                this.body.appendChild(empty);
                requestAnimationFrame(() => this.positionModal());
                return;
            }

            const classes = Model().rankClasses(ranked);
            const totals = new Map(ranked.map(({ tag, count }) => [tag, count]));
            Model().orderForDisplay(ranked, classes).forEach((tag, index) => {
                const selected = this.isTagActive(tag);
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `tag-cloud-word is-${classes.get(tag)}`;
                chip.dataset.tag = tag;
                chip.classList.toggle('is-selected', selected);
                chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
                chip.style.setProperty('--tag-index', String(index));

                const labelEl = document.createElement('span');
                labelEl.className = 'tag-cloud-word-label';
                labelEl.textContent = tag;
                const countEl = document.createElement('span');
                countEl.className = 'tag-cloud-word-count';
                countEl.setAttribute('aria-hidden', 'true');
                chip.append(labelEl, countEl);

                chip.setAttribute(
                    'aria-label',
                    t('dashboard.tagCloudFilterAria', 'Toggle tag {tag} in filter').replace('{tag}', tag)
                        + ` (${this.getTagCountLabel(totals.get(tag) || 0)})`
                );
                chip.addEventListener('click', (event) => {
                    this.selectTag(tag, { stack: event.shiftKey });
                });
                chip.addEventListener('focus', () => {
                    const chips = this.getTagChips();
                    const idx = chips.indexOf(chip);
                    if (idx >= 0) {
                        this._kbdFocusIndex = idx;
                        this._kbdFocusZone = 'chip';
                        this.clearBtn?.classList.remove('is-keyboard-focused');
                        chips.forEach((el, j) => {
                            el.classList.toggle('is-keyboard-focused', j === idx);
                        });
                    }
                });
                this.body.appendChild(chip);
            });
            this.refreshChipCounts();
            if (this._demo) this.body.appendChild(this.buildDemoNote());

            requestAnimationFrame(() => this.positionModal());
        },

        /** What the example is, how to get the real thing, and the Tags view. */
        buildDemoNote() {
            const note = document.createElement('div');
            note.className = 'tag-cloud-demo-note';
            note.dataset.tagCloudDemo = '';
            const text = document.createElement('p');
            text.textContent = t('dashboard.tagCloudDemoNote',
                'These are example tags. Tag a bookmark (right-click, then Tags) and your own words appear here; pick one to see its bookmarks.');
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'tag-cloud-demo-view';
            open.textContent = t('dashboard.tagCloudDemoView', 'Open the Tags view');
            open.addEventListener('click', () => {
                // Going to the Tags view is what the example was for: the
                // owner's callback hears it as that, not as a plain close.
                const afterDemo = this._onDemoClose;
                this._onDemoClose = null;
                this.closeModal({ animate: false });
                afterDemo?.({ toTags: true });
                window.location.hash = 'tags';
            });
            note.append(text, open);
            return note;
        },

        /**
         * The words fade in once, as the cloud opens, and then hold still.
         * Not on a redraw after a pick or a keystroke: a cloud that replays its
         * entrance under the pointer is a cloud you cannot click.
         */
        playEntrance() {
            if (!this.body) return;
            if (this._entranceTimerId) clearTimeout(this._entranceTimerId);
            this.body.classList.add('is-entering');
            this._entranceTimerId = window.setTimeout(() => {
                this._entranceTimerId = null;
                this.body?.classList.remove('is-entering');
            }, 900);
        },

        /**
         * A pick is a destination: filter on that one tag, close, and land on
         * the grid. Shift stacks instead -- the tag joins or leaves the filter
         * and the cloud stays open. The only tag that is filtering, picked
         * again, switches the filter off.
         */
        selectTag(tag, { stack = false } = {}) {
            // The words of the example are nobody's tags: nothing to pick.
            if (this._demo) return;
            const normalized = String(tag || '').trim().toLowerCase();
            if (!normalized) return;
            const dash = window.dashboardInstance;
            this.setQuery('');
            if (stack) {
                void dash?.toggleTagFilter?.(normalized);
                return;
            }
            const current = this.normalizeActiveTags();
            const next = current.length === 1 && current[0] === normalized ? [] : [normalized];
            /*
             * A pick into a view carries on into it: the picked word travels to
             * the view's title while the page cross-fades (View Transitions),
             * where the browser has them and animations are on. Either way the
             * cloud goes at once -- a cloud still fading out over the view held
             * the keyboard for its last 180ms.
             */
            const chip = this.getTagChips().find((el) => el.dataset.tag === normalized);
            if (next.length && this.canAnimatePick()) {
                if (chip) chip.style.viewTransitionName = 'tag-pick';
                const root = document.documentElement;
                const transition = document.startViewTransition(async () => {
                    this.closeModal({ animate: false });
                    if (chip) chip.style.viewTransitionName = '';
                    root.dataset.tagPick = '1';
                    await dash?.setTagFilters?.(next);
                });
                const done = () => { delete root.dataset.tagPick; };
                Promise.resolve(transition?.finished).then(done, done);
                return;
            }
            this.closeModal({ animate: false });
            void Promise.resolve(dash?.setTagFilters?.(next)).then(() => {
                if (!next.length) this.restoreBookmarkFocus();
            });
        },

        canAnimatePick() {
            if (typeof document.startViewTransition !== 'function') return false;
            if (document.body.classList.contains('no-animations')) return false;
            return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        },

        clearDashboardFilter({ animate = true, closeModal = false, focusBookmarks = false } = {}) {
            this.activeTags = [];
            void window.dashboardInstance?.setTagFilters?.([], { animate });
            this.syncToggleState();
            this.updateClearButton();

            if (closeModal && this.modalOpen) {
                this.closeModal({ animate, focusBookmarks });
                return;
            }

            if (this.modalOpen) {
                this.updateChipSelection();
                if (this._kbdFocusZone === 'clear') {
                    requestAnimationFrame(() => this.focusInitialChip());
                }
            }

            if (focusBookmarks) {
                this.restoreBookmarkFocus();
            }
        },

        updateClearButton() {
            if (!this.clearBtn) return;
            const show = this.normalizeActiveTags().length > 0;
            // The footer stays: it carries the key legend, and the clear button
            // joins it only while something is filtering.
            this.clearBtn.hidden = !show;
            if (this.modalOpen) {
                requestAnimationFrame(() => this.positionModal());
            }
        },

        setActiveTags(tags) {
            this.activeTags = this.normalizeActiveTags(tags);
            this.syncToggleState();
            this.updateClearButton();
            if (this.modalOpen) {
                this.updateChipSelection();
            }
        },

        setActiveTag(tag) {
            const normalized = String(tag || '').trim().toLowerCase();
            this.setActiveTags(normalized ? [normalized] : []);
        },

        handleSlashKey(event) {
            if (!this.isEligible()) return false;
            if (event.ctrlKey || event.altKey || event.metaKey) return false;
            event.preventDefault();
            event.stopPropagation();
            if (this.modalOpen) {
                this.closeModal();
            } else {
                this.openModal();
            }
            return true;
        },
    };

    window.DashboardTagCloud = DashboardTagCloud;
    // Shared with the config bookmarks tag cloud, which ranks the same tags the
    // same way. Exported rather than copied so the two orderings cannot drift.
    window.DashboardTagCloud.countTagsFromBookmarks = countTagsFromBookmarks;
})();
