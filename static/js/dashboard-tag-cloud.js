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
        activeTag: '',
        _kbdFocusIndex: 0,
        _kbdFocusZone: 'chip',

        init() {
            this.wrap = document.getElementById('dashboard-tag-cloud-wrap');
            this.modal = document.getElementById('tag-cloud-modal');
            this.backdrop = document.getElementById('tag-cloud-modal-backdrop');
            this.body = document.getElementById('tag-cloud-modal-body');
            this.toggle = document.getElementById('tag-cloud-toggle-btn');
            this.closeBtn = document.getElementById('tag-cloud-modal-close');
            this.clearBtn = document.getElementById('tag-cloud-clear-filter');
            if (!this.wrap || !this.modal || !this.body || !this.toggle) return;

            this.toggle.addEventListener('click', () => this.onToggleClick());
            this.closeBtn?.addEventListener('click', () => this.closeModal());
            this.backdrop?.addEventListener('click', () => this.closeModal());
            this.clearBtn?.addEventListener('click', () => {
                this.clearDashboardFilter({ closeModal: true, focusBookmarks: true });
            });
            this.clearBtn?.addEventListener('focus', () => {
                this._kbdFocusZone = 'clear';
                this.getTagChips().forEach((el) => el.classList.remove('is-keyboard-focused'));
                this.clearBtn?.classList.add('is-keyboard-focused');
            });
            window.addEventListener('resize', () => {
                if (this.modalOpen) this.positionModal();
                this.syncFromSettings();
            });

            this._boundModalKeydown = (e) => this.handleModalKeydown(e);
            document.addEventListener('keydown', this._boundModalKeydown, true);

            this.syncFromSettings();
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
            if (this.activeTag) {
                const match = chips.findIndex(
                    (el) => el.querySelector('.tag-cloud-word-label')?.textContent === this.activeTag
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
            const filtered = Boolean(this.activeTag);
            this.toggle.classList.toggle('is-active', this.modalOpen || filtered);
            this.toggle.setAttribute('aria-expanded', this.modalOpen ? 'true' : 'false');
            document.body.setAttribute('data-tag-cloud-modal-open', this.modalOpen ? 'true' : 'false');
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
            window.setTimeout(finish, 180);
        },

        positionModal() {
            if (!this.modal || !this.toggle) return;
            const rect = this.toggle.getBoundingClientRect();
            const margin = 10;
            const modalRect = this.modal.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let left = rect.left;
            let bottom = vh - rect.top + margin;

            const maxW = Math.min(520, vw - margin * 2);
            this.modal.style.width = `${maxW}px`;
            this.modal.style.maxWidth = `${maxW}px`;

            if (left + maxW > vw - margin) {
                left = vw - margin - maxW;
            }
            if (left < margin) left = margin;

            const modalH = this.modal.offsetHeight || modalRect.height || 200;
            if (rect.top - margin - modalH < margin) {
                bottom = vh - rect.bottom - margin;
                this.modal.style.bottom = `${bottom}px`;
                this.modal.style.top = 'auto';
            } else {
                this.modal.style.bottom = `${bottom}px`;
                this.modal.style.top = 'auto';
            }

            this.modal.style.left = `${Math.round(left)}px`;
            this.modal.style.right = 'auto';

            const dockRight = document.body.getAttribute('data-button-position') === 'bottom-left';
            if (dockRight) {
                left = rect.right - maxW;
                if (left < margin) left = margin;
                this.modal.style.left = `${Math.round(left)}px`;
            }
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
                return;
            }

            this.body.classList.add('tag-cloud-wordcloud--live');

            ranked.forEach(({ tag, count }, index) => {
                const scale = scaleForCount(count, minCount, maxCount);
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `tag-cloud-word ${tierClassForScale(scale)}`;
                if (this.activeTag === tag) chip.classList.add('is-selected');
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

                const countLabel = count === 1 ? '1 bookmark' : `${count} bookmarks`;
                chip.title = `#${tag} — ${countLabel}`;
                chip.setAttribute(
                    'aria-label',
                    t('dashboard.tagCloudFilterAria', 'Show only bookmarks with tag {tag}').replace('{tag}', tag)
                        + ` (${countLabel})`
                );
                chip.addEventListener('click', () => this.selectTag(tag));
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
            if (this.activeTag === normalized) {
                this.clearDashboardFilter({ closeModal: true, focusBookmarks: true });
                return;
            }
            this.activeTag = normalized;
            this.closeModal();
            window.dashboardInstance?.applyTagFilter?.(normalized);
            this.syncToggleState();
            this.updateClearButton();
        },

        clearDashboardFilter({ animate = true, closeModal = false, focusBookmarks = false } = {}) {
            this.activeTag = '';
            window.dashboardInstance?.applyTagFilter?.('', { animate });
            this.syncToggleState();
            this.updateClearButton();

            if (closeModal && this.modalOpen) {
                this.closeModal({ animate, focusBookmarks });
                return;
            }

            if (this.modalOpen) {
                this.renderWordCloud();
                if (this._kbdFocusZone === 'clear') {
                    requestAnimationFrame(() => this.focusInitialChip());
                }
            }
        },

        updateClearButton() {
            if (!this.clearBtn) return;
            const show = Boolean(this.activeTag);
            this.clearBtn.hidden = !show;
        },

        setActiveTag(tag) {
            this.activeTag = String(tag || '').trim().toLowerCase();
            this.syncToggleState();
            this.updateClearButton();
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
