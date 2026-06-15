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

    function countTagsFromBookmarks(bookmarks) {
        const counts = new Map();
        const list = Array.isArray(bookmarks) ? bookmarks : [];
        for (const bookmark of list) {
            const tags = Array.isArray(bookmark?.tags) ? bookmark.tags : [];
            for (const raw of tags) {
                const tag = String(raw || '').trim().toLowerCase();
                if (!tag) continue;
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({ tag, count }));
    }

    /** Slight tilt for word-cloud feel; kept small for readability. */
    function hashRotate(tag) {
        let h = 0;
        for (let i = 0; i < tag.length; i++) {
            h = (h * 31 + tag.charCodeAt(i)) | 0;
        }
        return ((h % 9) - 4) * 0.55;
    }

    /** 0–1 scale with boosted contrast between low and high usage. */
    function scaleForCount(count, minCount, maxCount) {
        if (maxCount <= 0) return 0.5;
        if (maxCount === minCount) return 1;
        const ratio = (count - minCount) / (maxCount - minCount);
        return 0.28 + 0.72 * Math.pow(Math.max(0, Math.min(1, ratio)), 0.72);
    }

    function tierClassForScale(scale) {
        if (scale >= 0.82) return 'tag-cloud-word--tier-xl';
        if (scale >= 0.62) return 'tag-cloud-word--tier-lg';
        if (scale >= 0.42) return 'tag-cloud-word--tier-md';
        if (scale >= 0.22) return 'tag-cloud-word--tier-sm';
        return 'tag-cloud-word--tier-xs';
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
                const tag = chip.querySelector('.tag-cloud-word-label')?.textContent || '';
                const selected = active.has(tag);
                chip.classList.toggle('is-selected', selected);
                chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
            });
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
                const chips = this.getTagChips();
                if (!chips.length) return;
                if (direction === 'up' || direction === 'left') {
                    this.focusChipAtIndex(this._kbdFocusIndex, chips);
                } else if (direction === 'down' || direction === 'right') {
                    this.focusChipAtIndex(0, chips);
                }
                return;
            }

            const chips = this.getTagChips();
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
                    (el) => active.has(el.querySelector('.tag-cloud-word-label')?.textContent || '')
                );
                if (match >= 0) idx = match;
            }
            requestAnimationFrame(() => {
                requestAnimationFrame(() => this.focusChipAtIndex(idx, chips));
            });
        },

        handleModalKeydown(e) {
            if (!this.modalOpen) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.closeModal();
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
                    const tag = active.querySelector('.tag-cloud-word-label')?.textContent;
                    if (tag) this.selectTag(tag);
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
                if (chips.length) this.focusChipAtIndex(0, chips);
                else if (this.isClearButtonFocusable()) this.focusClearButton();
                return;
            }

            if (e.key === 'End') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (this.isClearButtonFocusable()) this.focusClearButton();
                else if (chips.length) this.focusChipAtIndex(chips.length - 1, chips);
            }
        },

        getBookmarkPool() {
            const dash = window.dashboardInstance;
            if (!dash) return [];
            return dash.settings?.globalShortcuts
                ? dash.allBookmarks
                : dash.allBookmarks?.length
                  ? dash.allBookmarks
                  : dash.bookmarks;
        },

        isFeatureAllowedInSettings() {
            return window.dashboardInstance?.settings?.showTagCloudButton === true;
        },

        libraryHasTags() {
            return countTagsFromBookmarks(this.getBookmarkPool()).length > 0;
        },

        isEligible() {
            return (
                this.isFeatureAllowedInSettings() &&
                this.libraryHasTags() &&
                !isMobileLayout()
            );
        },

        syncFromSettings() {
            if (!this.wrap) return;

            const eligible = this.isEligible();
            this.wrap.classList.toggle('is-eligible', eligible);
            document.body.setAttribute(
                'data-show-tag-cloud-button',
                this.isFeatureAllowedInSettings() ? 'true' : 'false'
            );

            if (!eligible) {
                this.closeModal({ animate: false });
                this.clearDashboardFilter({ animate: false });
                return;
            }

            this.syncToggleState();
        },

        syncToggleState() {
            if (!this.toggle) return;
            const tags = this.normalizeActiveTags();
            const filtered = tags.length > 0;
            this.toggle.classList.toggle('is-active', this.modalOpen || filtered);
            this.toggle.setAttribute('aria-expanded', this.modalOpen ? 'true' : 'false');
            document.body.setAttribute('data-tag-cloud-modal-open', this.modalOpen ? 'true' : 'false');
            document.body.setAttribute('data-tag-filter-active', filtered ? 'true' : 'false');

            if (filtered) {
                const tagsLabel = this.formatActiveTagsLabel();
                const tip = t('dashboard.tagFilterActiveTooltip', 'Filtering: {tags}').replace('{tags}', tagsLabel);
                this.toggle.setAttribute('data-tooltip', tip);
            } else {
                const defaultTip = t('dashboard.tagCloudToggleTooltip', '/ tags');
                this.toggle.setAttribute('data-tooltip', defaultTip);
            }
        },

        onToggleClick() {
            if (!this.isEligible()) return;
            if (this.modalOpen) {
                this.closeModal();
            } else {
                this.openModal();
            }
        },

        openModal() {
            if (!this.isEligible() || !this.modal) return;
            if (this._closeTimerId) {
                clearTimeout(this._closeTimerId);
                this._closeTimerId = null;
            }
            this.syncActiveTagsFromDashboard();
            this.renderWordCloud();
            this.updateClearButton();
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
                    window.DashboardFeaturePromos?.tryShow?.('tagCloud', this.modal);
                });
            });
            this.syncToggleState();
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
                if (focusBookmarks) {
                    this.restoreBookmarkFocus();
                } else if (document.activeElement?.closest?.('#tag-cloud-modal')) {
                    this.toggle?.focus?.();
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

        getModalMaxHeight(rect, margin, vh, anchor = 'above') {
            const spaceAlongAnchor = anchor === 'below'
                ? Math.max(120, vh - rect.bottom - margin * 2)
                : Math.max(120, rect.top - margin * 2);
            let maxH = Math.min(vh * 0.88, spaceAlongAnchor);

            const layout = document.getElementById('dashboard-layout');
            if (layout) {
                const layoutRect = layout.getBoundingClientRect();
                const spaceInColumn = anchor === 'below'
                    ? layoutRect.bottom - rect.bottom - margin
                    : rect.top - layoutRect.top - margin;
                if (spaceInColumn > 0) {
                    maxH = Math.min(maxH, spaceInColumn);
                }
            }

            return Math.round(maxH);
        },

        syncModalSize(maxHeight) {
            if (!this.modal || !this.body) return;

            this.modal.style.height = 'auto';
            this.modal.style.maxHeight = 'none';
            this.body.style.maxHeight = '';
            this.body.classList.remove('is-scrollable');

            const naturalH = this.modal.offsetHeight;
            const cap = Math.max(120, maxHeight);
            this.modal.style.maxHeight = `${cap}px`;
            this.modal.style.setProperty('--tag-cloud-modal-max-height', `${cap}px`);

            if (naturalH <= cap) {
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

            const dockRight = document.body.getAttribute('data-button-position') === 'bottom-left';
            let left = dockRight ? rect.right - maxW : rect.left;
            if (left + maxW > vw - margin) {
                left = vw - margin - maxW;
            }
            if (left < margin) left = margin;
            this.modal.style.left = `${Math.round(left)}px`;
            this.modal.style.right = 'auto';

            let anchor = 'above';
            let maxModalH = this.getModalMaxHeight(rect, margin, vh, anchor);
            this.syncModalSize(maxModalH);

            let modalH = this.modal.offsetHeight || 200;
            let bottom = vh - rect.top + margin;
            if (rect.top - margin - modalH < margin) {
                anchor = 'below';
                bottom = vh - rect.bottom - margin;
                maxModalH = this.getModalMaxHeight(rect, margin, vh, anchor);
                this.syncModalSize(maxModalH);
                modalH = this.modal.offsetHeight || modalH;
            }

            this.modal.style.bottom = `${bottom}px`;
            this.modal.style.top = 'auto';
            window.DashboardFeaturePromos?.reposition?.();
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
            const ranked = countTagsFromBookmarks(this.getBookmarkPool());
            const maxCount = ranked[0]?.count || 1;
            const minCount = ranked[ranked.length - 1]?.count || maxCount;

            this.body.replaceChildren();
            if (!ranked.length) {
                const empty = document.createElement('p');
                empty.className = 'tag-cloud-modal-empty';
                empty.textContent = t('dashboard.tagCloudEmpty', 'No tags yet — add tags in config → bookmarks.');
                this.body.appendChild(empty);
                requestAnimationFrame(() => this.positionModal());
                return;
            }

            this.body.classList.add('tag-cloud-wordcloud--live');

            ranked.forEach(({ tag, count }, index) => {
                const scale = scaleForCount(count, minCount, maxCount);
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `tag-cloud-word ${tierClassForScale(scale)}`;
                if (this.isTagActive(tag)) chip.classList.add('is-selected');
                chip.setAttribute('aria-pressed', this.isTagActive(tag) ? 'true' : 'false');
                chip.style.setProperty('--tag-scale', scale.toFixed(3));
                chip.style.setProperty('--tag-rotate', `${hashRotate(tag).toFixed(2)}deg`);
                chip.style.setProperty('--tag-index', String(index));

                const hashEl = document.createElement('span');
                hashEl.className = 'tag-cloud-word-hash';
                hashEl.textContent = '#';
                hashEl.setAttribute('aria-hidden', 'true');
                const labelEl = document.createElement('span');
                labelEl.className = 'tag-cloud-word-label';
                labelEl.textContent = tag;
                chip.append(hashEl, labelEl);

                const countLabel = this.getTagCountLabel(count);
                chip.title = `#${tag} — ${countLabel}`;
                chip.setAttribute(
                    'aria-label',
                    t('dashboard.tagCloudFilterAria', 'Toggle tag {tag} in filter').replace('{tag}', tag)
                        + ` (${countLabel})`
                );
                chip.addEventListener('click', () => {
                    this.selectTag(tag);
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

            requestAnimationFrame(() => this.positionModal());
        },

        selectTag(tag) {
            const normalized = String(tag || '').trim().toLowerCase();
            if (!normalized) return;
            void window.dashboardInstance?.toggleTagFilter?.(normalized);
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
            this.clearBtn.hidden = !show;
            const footer = this.clearBtn.closest('.tag-cloud-modal-footer');
            if (footer) footer.hidden = !show;
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
})();
