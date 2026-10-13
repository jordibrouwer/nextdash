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

        /** Pick nearest tag in arrow direction (wrapped flex word cloud). */
        findSpatialNeighbor(fromEl, direction, chips = this.getTagChips()) {
            if (!fromEl || !chips.length) return null;
            const cur = fromEl.getBoundingClientRect();
            const cx = cur.left + cur.width / 2;
            const cy = cur.top + cur.height / 2;
            const eps = 4;
            let best = null;
            let bestScore = Infinity;

            for (const el of chips) {
                if (el === fromEl) continue;
                const r = el.getBoundingClientRect();
                const ox = r.left + r.width / 2;
                const oy = r.top + r.height / 2;
                const dx = ox - cx;
                const dy = oy - cy;
                if (direction === 'left' && dx >= -eps) continue;
                if (direction === 'right' && dx <= eps) continue;
                if (direction === 'up' && dy >= -eps) continue;
                if (direction === 'down' && dy <= eps) continue;
                const primary =
                    direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
                const secondary =
                    direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
                const score = primary * 1000 + secondary;
                if (score < bestScore) {
                    bestScore = score;
                    best = el;
                }
            }
            return best;
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

            const currentIdx = this.getFocusedChipIndex(chips);
            const current = chips[currentIdx] || chips[0];
            const candidates = [...chips];
            if (direction === 'down' && this.isClearButtonFocusable()) {
                candidates.push(this.clearBtn);
            }
            const neighbor = this.findSpatialNeighbor(current, direction, candidates);
            if (neighbor === this.clearBtn) {
                this.focusClearButton();
                return;
            }
            if (neighbor) {
                this.focusChipAtIndex(chips.indexOf(neighbor), chips);
                return;
            }

            if (direction === 'down' && this.isClearButtonFocusable()) {
                this.focusClearButton();
                return;
            }

            const delta =
                direction === 'right' || direction === 'down'
                    ? 1
                    : direction === 'left' || direction === 'up'
                      ? -1
                      : 0;
            this.focusChipAtIndex(currentIdx + delta, chips);
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
            const pool = dash.settings?.globalShortcuts
                ? dash.allBookmarks
                : dash.allBookmarks?.length
                  ? dash.allBookmarks
                  : dash.bookmarks;
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
            // The / FAB filters the bookmarks grid, so it has nothing to do
            // outside the dashboard -- gated here, at the source, rather than
            // at each caller (the toggle button's own CSS, handleSlashKey, and
            // the tag-filter-indicator chip all read this one answer).
            const dash = window.dashboardInstance;
            return this.isFeatureAvailable() && (!dash || dash.isBookmarksView());
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
                 * Only when the feature is gone, not when a view is merely on
                 * top of it. This runs on every view transition, so clearing on
                 * plain ineligibility threw the tag filter away the moment you
                 * opened config, inbox or health -- and the header chip that
                 * exists to show the filter in exactly those views had nothing
                 * left to show.
                 */
                if (!this.isFeatureAvailable()) {
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
            if (this.isFeatureAvailable() && dash && !dash.isBookmarksView()) {
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

        openModal() {
            if (!this.isEligible() || !this.modal) return;
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
            this.syncFromSettings();
            window.nextdashTrack?.('modal:tag-cloud');
            if (this._closeTimerId) {
                clearTimeout(this._closeTimerId);
                this._closeTimerId = null;
            }
            this.syncActiveTagsFromDashboard();
            this.renderWordCloud();
            this.playEntrance();
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
         * Hang the cloud under the header button, fully inside the window.
         *
         * Right-aligned to the button rather than left, because the actions sit
         * at the right end of the bar: left-aligned, a wide cloud would run off
         * the screen before the clamp caught it and land somewhere it was never
         * anchored to.
         */
        positionModalUnderHeaderButton(rect, margin, vw, vh, maxW) {
            let left = rect.right - maxW;
            if (left + maxW > vw - margin) left = vw - margin - maxW;
            if (left < margin) left = margin;

            const top = rect.bottom + margin;
            // What is left of the window under the button, and never taller.
            const maxH = Math.max(160, Math.round(vh - top - margin));
            this.syncModalSize(maxH);

            this.modal.style.left = `${Math.round(left)}px`;
            this.modal.style.right = 'auto';
            this.modal.style.top = `${Math.round(top)}px`;
            this.modal.style.bottom = 'auto';
        },

        /**
         * Open away from a docked bar, fully inside the window.
         *
         * The button stands in the same group wherever the bar is, so the
         * header's "hang under it" also ran for a bar at the bottom of the
         * window -- and put the cloud under the window's edge. A bottom dock
         * opens it above the button; a side column beside it, towards the page.
         * A dock that has slid away still has a place to open from: the edge it
         * slid into, which the clamps below keep the cloud inside of.
         */
        positionModalBesideDock(place, rect, margin, vw, vh, maxW) {
            if (place === 'bottom') {
                const edge = Math.min(rect.top, vh - margin);
                const maxH = Math.max(160, Math.round(edge - margin * 2));
                this.syncModalSize(maxH);
                const centre = rect.left + rect.width / 2;
                let left = centre - maxW / 2;
                left = Math.min(Math.max(left, margin), vw - margin - maxW);
                this.modal.style.left = `${Math.round(left)}px`;
                this.modal.style.right = 'auto';
                this.modal.style.top = 'auto';
                this.modal.style.bottom = `${Math.round(vh - edge + margin)}px`;
                return;
            }
            const maxH = Math.max(160, Math.round(vh - margin * 2));
            this.syncModalSize(maxH);
            const modalH = this.modal.offsetHeight || 200;
            let left = place === 'left'
                ? Math.max(rect.right, 0) + margin
                : Math.min(rect.left, vw) - margin - maxW;
            left = Math.min(Math.max(left, margin), vw - margin - maxW);
            let top = rect.top + rect.height / 2 - modalH / 2;
            top = Math.min(Math.max(top, margin), vh - margin - modalH);
            this.modal.style.left = `${Math.round(left)}px`;
            this.modal.style.right = 'auto';
            this.modal.style.top = `${Math.round(top)}px`;
            this.modal.style.bottom = 'auto';
        },

        positionModal() {
            if (!this.modal || !this.toggle) return;
            const rect = this.toggle.getBoundingClientRect();
            const margin = 10;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            const tagCount = this.body?.querySelectorAll('.tag-cloud-word').length || 0;
            const idealW = 320 + Math.sqrt(tagCount) * 42;
            const maxW = Math.min(Math.max(idealW, 300), Math.min(680, vw - margin * 2));
            this.modal.style.width = `${Math.round(maxW)}px`;
            this.modal.style.maxWidth = `${Math.round(maxW)}px`;

            // The button always stands in the header group (setupDOM moves it
            // there), so the cloud is a dropdown from it: under the button for a
            // header bar, beside it for a docked one, clamped into the window.
            let place = document.body.getAttribute('data-action-bar') || 'header';
            // On a phone the side columns stand at the bottom.
            if ((place === 'left' || place === 'right')
                && window.matchMedia?.('(max-width: 700px)').matches) {
                place = 'bottom';
            }
            if (place === 'bottom' || place === 'left' || place === 'right') {
                this.positionModalBesideDock(place, rect, margin, vw, vh, maxW);
            } else {
                this.positionModalUnderHeaderButton(rect, margin, vw, vh, maxW);
            }
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
            const ranked = Model().countTags(pool);

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

            requestAnimationFrame(() => this.positionModal());
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
            void Promise.resolve(dash?.setTagFilters?.(next)).then(() => {
                this.closeModal({ focusBookmarks: true });
            });
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
