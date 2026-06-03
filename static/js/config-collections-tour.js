/**
 * One-time guided tour on Config → Collections (tag / category / shortcut rules, demo, cleanup).
 * Same UX as other config tours: CSS box-shadow cutout + scroll lock per step.
 */
class ConfigCollectionsTour {
    static STORAGE_KEY = 'nextdash:config-collections-tour-v1';
    static DEMO_FLAG = '_configCollectionsTourDemo';
    static DEMO_NAME = 'Tour demo';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigCollectionsTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._demoCollectionId = null;
        this._demoOpenHandled = false;
        this._demoSaveHandled = false;
        this._demoCleanupHandled = false;
        this._demoCleanupInProgress = false;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigCollectionsTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="collections"]')) return 'no-collections-tab';
        return null;
    }

    t(key, fallback) {
        const full = `config.${key}`;
        if (!this.language || typeof this.language.t !== 'function') return fallback;
        const raw = this.language.t(full);
        return raw && raw !== full ? raw : fallback;
    }

    demoCollectionName() {
        return this.t('configCollectionsTourDemoName', ConfigCollectionsTour.DEMO_NAME);
    }

    hasCompletedTour() {
        if (this.hasSeen?.()) return true;
        try {
            return localStorage.getItem(this.storageKey) === '1';
        } catch {
            return false;
        }
    }

    canStart({ force = false } = {}) {
        if (!force && this.hasCompletedTour()) return false;
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return false;
        if (!document.querySelector('[data-tab-content="collections"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-collections-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-collections-tour-active');
        document.body.classList.remove('config-collections-tour-ready');
        document.documentElement.classList.remove('config-collections-tour-scroll-lock');
        document.body.classList.remove('config-collections-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-collections-tour-highlight')
            .forEach((el) => el.classList.remove('config-collections-tour-highlight'));
        if (window.configManager) {
            window.configManager._configCollectionsTourActive = false;
        }
    }

    ensureCollectionsTabActive() {
        const mgr = window.configManager;
        if (mgr?.isConfigCollectionsTabActive?.()) return;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('collections');
        } else {
            const panel = document.querySelector('[data-tab-content="collections"]');
            if (panel && !panel.classList.contains('active')) {
                document.querySelector('.tab-button[data-tab="collections"]')?.click();
            }
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (hash !== 'collections') {
            window.history.replaceState(null, '', '#collections');
        }
    }

    ensurePageReady() {
        if (document.body?.classList.contains('loading')) {
            if (window.SkeletonLoading?.finish) {
                window.SkeletonLoading.finish();
            } else {
                document.body.classList.remove('loading');
            }
        }
    }

    async waitForCollectionsTabActive(maxAttempts = 40) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureCollectionsTabActive();
            const panel = document.querySelector('[data-tab-content="collections"]');
            const list = document.getElementById('collections-list');
            if (panel && list && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="collections"]') &&
                document.getElementById('collections-list')
        );
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-collections-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-collections-tour-scroll-lock');
        document.body.classList.add('config-collections-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-collections-tour-scroll-lock');
        document.body.classList.remove('config-collections-tour-scroll-lock');
        document.body.style.top = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        this._lockedScrollY = null;
        if (typeof y === 'number') {
            window.scrollTo(0, y);
        }
    }

    resetCardPosition() {
        if (!this.card) return;
        this.card.classList.remove('is-docked');
        this.card.style.removeProperty('top');
        this.card.style.removeProperty('left');
        this.card.style.removeProperty('bottom');
        this.card.style.transform = '';
    }

    findDashboardBackLink() {
        return (
            document.querySelector('.header-links a.back-link[href="/"]') ||
            document.querySelector('a.back-link[href="/"]')
        );
    }

    positionCardNearTarget(element, step = {}) {
        if (!this.card) return;

        if (!element) {
            this.resetCardPosition();
            return;
        }

        const placement = step.cardPlacement || 'auto';
        if (
            placement === 'viewport-bottom' ||
            (placement === 'auto' && window.ConfigTourRuntime?.isOversizedHighlight?.(element))
        ) {
            window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);
            return;
        }

        const viewportPadding = 16;
        const headerClearance = 72;
        const gap = 20;
        const targetRect = element.getBoundingClientRect();

        this.resetCardPosition();
        const cardW = this.card.getBoundingClientRect().width || Math.min(640, window.innerWidth * 0.96);
        const cardH = this.card.getBoundingClientRect().height || 220;

        let placeAbove = placement === 'top';
        if (placement === 'auto') {
            const spaceBelow = window.innerHeight - targetRect.bottom - viewportPadding;
            const spaceAbove = targetRect.top - headerClearance - viewportPadding;
            placeAbove =
                targetRect.bottom > window.innerHeight * 0.5 ||
                (spaceBelow < cardH + gap && spaceAbove >= cardH + gap);
        } else if (placement === 'bottom') {
            placeAbove = false;
        }

        const maxLeft = Math.max(viewportPadding, window.innerWidth - cardW - viewportPadding);
        const centeredLeft = targetRect.left + targetRect.width / 2 - cardW / 2;
        const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));

        let top;
        if (placeAbove) {
            top = Math.max(
                headerClearance + viewportPadding,
                targetRect.top - cardH - gap
            );
        } else {
            top = Math.min(
                window.innerHeight - cardH - viewportPadding,
                targetRect.bottom + gap
            );
        }

        this.card.classList.add('is-docked');
        this.card.style.left = `${Math.round(left)}px`;
        this.card.style.top = `${Math.round(top)}px`;
        this.card.style.bottom = 'auto';
        this.card.style.transform = 'none';
    }

    getScrollMetrics() {
        const margin = 24;
        const stickyTop = 72;
        const cardRect = this.card?.getBoundingClientRect();
        if (cardRect && cardRect.height > 1 && this.card.classList.contains('is-docked')) {
            if (cardRect.top < window.innerHeight * 0.45) {
                return {
                    viewTop: cardRect.bottom + margin,
                    viewBottom: window.innerHeight - margin,
                };
            }
            return {
                viewTop: stickyTop + margin,
                viewBottom: cardRect.top - margin,
            };
        }
        const cardH = cardRect?.height || 220;
        return {
            viewTop: stickyTop + margin,
            viewBottom: window.innerHeight - cardH - margin,
        };
    }

    isElementInViewBand(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        const { viewTop, viewBottom } = this.getScrollMetrics();
        if (viewBottom <= viewTop + 40) return false;
        return rect.top >= viewTop - 8 && rect.bottom <= viewBottom + 8;
    }

    getScrollableAncestor(element) {
        let node = element?.parentElement;
        while (node && node !== document.body) {
            const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
            if (!style) break;
            const overflowY = style.overflowY;
            const canScroll =
                (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
                node.scrollHeight > node.clientHeight + 1;
            if (canScroll) return node;
            node = node.parentElement;
        }
        return null;
    }

    adjustScrollForViewBand(element, scrollParent = null) {
        if (!element) return;

        const { viewTop, viewBottom } = this.getScrollMetrics();

        const nudgeParent = (parent) => {
            if (!parent) return;
            const rect = element.getBoundingClientRect();
            if (rect.bottom > viewBottom) {
                parent.scrollTop += Math.round(rect.bottom - viewBottom + 16);
            }
            const afterDown = element.getBoundingClientRect();
            if (afterDown.top < viewTop) {
                parent.scrollTop -= Math.round(viewTop - afterDown.top + 16);
            }
        };

        nudgeParent(scrollParent);

        const scrollRoot = document.scrollingElement || document.documentElement;
        if (!scrollRoot) return;

        const rect = element.getBoundingClientRect();
        if (rect.top < viewTop) {
            scrollRoot.scrollTop += Math.round(rect.top - viewTop);
        } else if (rect.bottom > viewBottom) {
            scrollRoot.scrollTop += Math.round(rect.bottom - viewBottom);
        }
    }

    ensureTargetClearOfCard(element) {
        if (!element || !this.card) return;
        const targetRect = element.getBoundingClientRect();
        const cardRect = this.card.getBoundingClientRect();
        const overlaps =
            targetRect.bottom > cardRect.top - 12 && targetRect.top < cardRect.bottom + 12;
        if (!overlaps) return;

        const scrollRoot = document.scrollingElement || document.documentElement;
        if (!scrollRoot) return;

        if (cardRect.top <= targetRect.bottom && cardRect.top >= targetRect.top - 40) {
            scrollRoot.scrollTop += Math.round(targetRect.bottom - cardRect.top + 28);
        } else if (cardRect.bottom >= targetRect.top && cardRect.bottom <= targetRect.bottom + 40) {
            scrollRoot.scrollTop += Math.round(targetRect.top - cardRect.bottom - 28);
        }
    }

    findDemoCollection() {
        const mgr = window.configManager;
        if (!mgr?.collections) return null;
        const collections = mgr.collections._getCollections(mgr);
        return (
            collections.find((c) => c[ConfigCollectionsTour.DEMO_FLAG]) ||
            (this._demoCollectionId
                ? collections.find((c) => c.id === this._demoCollectionId)
                : null)
        );
    }

    findDemoCollectionElement() {
        const demo = this.findDemoCollection();
        if (!demo) return null;
        return document.querySelector(`.collection-item[data-id="${CSS.escape(demo.id)}"]`);
    }

    isEditPanelOpen() {
        const panel = document.getElementById('collections-edit-panel');
        return panel && !panel.hidden;
    }

    findRuleRow(field) {
        const panel = document.getElementById('collections-edit-panel');
        if (!panel || panel.hidden) return null;
        const rows = panel.querySelectorAll('.col-rule-row');
        for (const row of rows) {
            const sel = row.querySelector('.col-rule-field');
            if (sel?.value === field) return row;
        }
        return rows[0] || null;
    }

    pickDemoCategoryValue(mgr) {
        const all = mgr.allBookmarksData ?? [];
        const fromBookmark = all.find((b) => b.category)?.category;
        if (fromBookmark) return String(fromBookmark).trim().toLowerCase();
        return '';
    }

    pickDemoShortcutValue(mgr) {
        const all = mgr.allBookmarksData ?? [];
        const fromBookmark = all.find((b) => b.shortcut)?.shortcut;
        if (fromBookmark) return String(fromBookmark).trim().toLowerCase();
        return 'a';
    }

    buildDemoRules(mgr) {
        const categoryVal = this.pickDemoCategoryValue(mgr);
        const rules = [{ field: 'tag', operator: 'includes', value: 'tour-demo' }];
        if (categoryVal) {
            rules.push({ field: 'category', operator: 'includes', value: categoryVal });
        }
        rules.push({
            field: 'shortcut',
            operator: 'includes',
            value: this.pickDemoShortcutValue(mgr),
        });
        return rules;
    }

    async openDemoEditPanel() {
        const mgr = window.configManager;
        if (!mgr?.collections) return false;

        const existing = this.findDemoCollection();
        if (existing) {
            this._demoCollectionId = existing.id;
            mgr.collections._openEdit(existing, mgr);
            await this.waitMs(80);
            return this.isEditPanelOpen();
        }

        mgr.collections._openEdit(null, mgr);
        await this.waitMs(100);

        const panel = document.getElementById('collections-edit-panel');
        if (!panel || panel.hidden) return false;

        const nameInput = panel.querySelector('#col-edit-name');
        const iconInput = panel.querySelector('#col-edit-icon');
        const logicSelect = panel.querySelector('#col-edit-logic');
        const rulesContainer = panel.querySelector('#col-edit-rules');
        if (!nameInput || !rulesContainer) return false;

        nameInput.value = this.demoCollectionName();
        if (iconInput) iconInput.value = '★';
        if (logicSelect) logicSelect.value = 'or';

        rulesContainer.innerHTML = '';
        const rules = this.buildDemoRules(mgr);
        rules.forEach((rule) => mgr.collections._addRuleRow(rulesContainer, mgr, rule));
        if (!rules.some((r) => r.field === 'category')) {
            mgr.collections._addRuleRow(rulesContainer, mgr, {
                field: 'category',
                operator: 'includes',
                value: '',
            });
        }
        return true;
    }

    async saveDemoFromPanel() {
        const mgr = window.configManager;
        if (!mgr?.collections || !this.isEditPanelOpen()) return false;

        const panel = document.getElementById('collections-edit-panel');
        const name = (panel?.querySelector('#col-edit-name')?.value || '').trim();
        if (!name) return false;

        await mgr.collections._saveEdit(mgr);

        const collections = mgr.collections._getCollections(mgr);
        const col =
            collections.find((c) => c[ConfigCollectionsTour.DEMO_FLAG]) ||
            collections.find((c) => c.name === name) ||
            collections[collections.length - 1];
        if (!col) return false;

        col[ConfigCollectionsTour.DEMO_FLAG] = true;
        this._demoCollectionId = col.id;
        mgr.settingsData.collections = collections;
        await mgr.collections._saveToServer(mgr);
        mgr.signalDashboardSettingsUpdated?.('settings-updated');
        return true;
    }

    async removeTourDemoCollection({ silent = false } = {}) {
        const mgr = window.configManager;
        if (!mgr?.collections) return true;

        const col = this.findDemoCollection();
        if (!col) {
            this._demoCollectionId = null;
            return true;
        }

        if (!silent) {
            await mgr.collections._deleteCollection(col, mgr);
            this._demoCollectionId = this.findDemoCollection() ? this._demoCollectionId : null;
            mgr.signalDashboardSettingsUpdated?.('settings-updated');
            return !this.findDemoCollection();
        }

        const ownedLock = !this._demoCleanupInProgress;
        if (ownedLock) this._demoCleanupInProgress = true;
        try {
            const collections = mgr.collections
                ._getCollections(mgr)
                .filter((c) => c.id !== col.id && !c[ConfigCollectionsTour.DEMO_FLAG]);
            mgr.settingsData.collections = collections;
            this._demoCollectionId = null;
            mgr.collections.refresh(mgr);
            await mgr.collections._saveToServer(mgr);
            mgr.signalDashboardSettingsUpdated?.('settings-updated');
            return true;
        } catch (error) {
            console.warn('Collections tour: silent remove failed', error);
            return false;
        } finally {
            if (ownedLock) this._demoCleanupInProgress = false;
        }
    }

    async cleanupTourDemoCollection({ prompt = false } = {}) {
        if (!this.findDemoCollection()) return true;
        if (this._demoCleanupInProgress) return false;

        this._demoCleanupInProgress = true;
        try {
            if (prompt) {
                this.unlockScroll();
                let confirmed = false;
                try {
                    if (window.AppModal?.confirm) {
                        confirmed = await window.ConfigTourRuntime?.withAppModal?.(() =>
                            window.AppModal.confirm({
                                title: this.t(
                                    'configCollectionsTourCleanupConfirmTitle',
                                    'Remove the demo collection?'
                                ),
                                message: this.t(
                                    'configCollectionsTourCleanupConfirmMessage',
                                    'We added a temporary collection only for this tour. Remove it now so your dashboard stays unchanged.'
                                ),
                                confirmText: this.t(
                                    'configCollectionsTourCleanupConfirmYes',
                                    'Remove demo'
                                ),
                                cancelText: this.t('config.cancel', 'Cancel'),
                            })
                        );
                    } else {
                        confirmed = window.confirm(
                            this.t(
                                'configCollectionsTourCleanupConfirmMessage',
                                'Remove the demo collection from this tour?'
                            )
                        );
                    }
                } catch {
                    confirmed = false;
                }
                if (!confirmed) return false;
            }
            return await this.removeTourDemoCollection({ silent: true });
        } finally {
            this._demoCleanupInProgress = false;
        }
    }

    async ensureDemoRemoved() {
        if (!this.findDemoCollection()) return true;
        return this.removeTourDemoCollection({ silent: true });
    }

    async promptOpenDemoEditor() {
        this.unlockScroll();

        const title = this.t('configCollectionsTourDemoConsentTitle', 'Build a demo collection?');
        const message = this.t(
            'configCollectionsTourDemoConsentMessage',
            'We open the editor and add example rules for tag, category, and shortcut (OR logic). You save it for the tour and we remove it before the end — nothing stays on your dashboard.'
        );

        let confirmed = false;
        try {
            if (window.AppModal?.confirm) {
                confirmed = await window.ConfigTourRuntime?.withAppModal?.(() =>
                    window.AppModal.confirm({
                        title,
                        message,
                        confirmText: this.t('configCollectionsTourDemoConsentYes', 'Show me'),
                        cancelText: this.t('configCollectionsTourDemoConsentNo', 'Skip demo'),
                    })
                );
            } else {
                confirmed = window.confirm(`${title}\n\n${message}`);
            }
        } catch {
            confirmed = false;
        }

        if (!confirmed) return false;
        return this.openDemoEditPanel();
    }

    async handleDemoOpenStep(step) {
        if (this._demoOpenHandled) return;
        this._demoOpenHandled = true;

        const opened = await this.promptOpenDemoEditor();
        if (opened) {
            step.body = this.t(
                'configCollectionsTourDemoOpenedBody',
                'The editor is open with three example rules. Each rule uses Tag, Category, or Shortcut — bookmarks that match appear in this collection on the dashboard.'
            );
            step.getTarget = () => document.getElementById('collections-edit-panel');
            step.selector = null;
            step.cardPlacement = 'viewport-bottom';
            step.scrollBlock = 'start';
        } else {
            step.body = this.t(
                'configCollectionsTourDemoSkippedBody',
                'Click + New collection to open the editor. Add rules with the field dropdown: Tag, Category, or Shortcut — then set includes/excludes and a value.'
            );
            step.selector = '#add-collection-btn';
            step.getTarget = null;
        }
    }

    async handleSaveStep(step) {
        if (this._demoSaveHandled) return;
        this._demoSaveHandled = true;

        if (this.findDemoCollection() && !this.isEditPanelOpen()) {
            step.body = this.t(
                'configCollectionsTourSaveDoneBody',
                'Your demo collection is saved. It appears in the list and on the dashboard as a dynamic column when rules match bookmarks.'
            );
            step.getTarget = () => this.findDemoCollectionElement() || document.getElementById('collections-list');
            step.selector = null;
            return;
        }

        if (!this.isEditPanelOpen()) {
            step.body = this.t(
                'configCollectionsTourSaveSkippedBody',
                'Click Save in the editor when your rules are ready. Collections are stored in settings and show on the dashboard immediately.'
            );
            step.selector = '#add-collection-btn';
            step.getTarget = null;
            return;
        }

        const saved = await this.saveDemoFromPanel();
        if (saved) {
            step.body = this.t(
                'configCollectionsTourSaveDoneBody',
                'Your demo collection is saved. It appears in the list and on the dashboard as a dynamic column when rules match bookmarks.'
            );
            step.getTarget = () => this.findDemoCollectionElement() || document.getElementById('collections-list');
            step.selector = null;
        } else {
            step.body = this.t(
                'configCollectionsTourSaveFailedBody',
                'Fill in a name and at least one rule value, then click Save. Use OR logic so bookmarks matching any rule are included.'
            );
            step.getTarget = () => document.getElementById('col-edit-save');
            step.selector = null;
        }
    }

    async handleCleanupStep(step) {
        if (this._demoCleanupHandled) return;
        this._demoCleanupHandled = true;

        if (!this.findDemoCollection()) {
            step.body = this.t(
                'configCollectionsTourCleanupNoneBody',
                'There is no demo collection left. Use × on a row to delete a collection — bookmarks are not affected.'
            );
            step.getTarget = () => document.getElementById('collections-list');
            step.selector = null;
            return;
        }

        const removed = await this.cleanupTourDemoCollection({ prompt: true });
        if (removed) {
            step.body = this.t(
                'configCollectionsTourCleanupDoneBody',
                'The demo collection is removed. Your dashboard is back to how it was before the tour.'
            );
            step.getTarget = () => document.getElementById('collections-list');
            step.selector = null;
        } else {
            step.body = this.t(
                'configCollectionsTourCleanupKeptBody',
                'The demo collection is still listed. Click × on its row and confirm, or restart the tour from General → System tools.'
            );
            step.getTarget = () =>
                this.findDemoCollectionElement()?.querySelector('.btn-danger') ||
                this.findDemoCollectionElement();
            step.selector = null;
        }
    }

    async ensureEditPanelForRuleSteps() {
        if (this.isEditPanelOpen()) return true;
        if (this.findDemoCollection()) {
            const mgr = window.configManager;
            mgr.collections._openEdit(this.findDemoCollection(), mgr);
            await this.waitMs(80);
            return this.isEditPanelOpen();
        }
        return this.openDemoEditPanel();
    }

    revealTarget(step) {
        let element = null;
        if (typeof step?.getTarget === 'function') {
            element = step.getTarget();
        } else if (step?.selector) {
            element = document.querySelector(step.selector);
        }
        if (element?.hidden) {
            element.hidden = false;
            element.removeAttribute('hidden');
        }
        return element;
    }

    async scrollToStepTarget(element, step = {}, options = {}) {
        if (!element || typeof element.scrollIntoView !== 'function') return;

        this.unlockScroll();

        const block = options.block || step.scrollBlock || 'center';
        const scrollParent = this.getScrollableAncestor(element);
        const scrollTarget =
            element.closest('.bookmark-detail-section') ||
            element.closest('.collections-edit-panel') ||
            element;
        const needsScroll = !this.isElementInViewBand(element);

        if (needsScroll || scrollParent) {
            const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
            const isFixedLike = style && (style.position === 'fixed' || style.position === 'sticky');

            (scrollTarget || element).scrollIntoView({
                behavior: 'auto',
                block: scrollParent || isFixedLike ? 'nearest' : block,
                inline: 'nearest',
            });

            this.adjustScrollForViewBand(element, scrollParent);
            await this.waitMs(24);
            this.adjustScrollForViewBand(element, scrollParent);
            await this.waitMs(16);
        }

        window.ConfigTourRuntime?.applyCardPlacement?.(this, element, step);

        this.lockScroll();
    }

    buildSteps() {
        return [
            {
                title: this.t('configCollectionsTourWelcomeTitle', 'Welcome to Collections'),
                body: this.t(
                    'configCollectionsTourWelcomeBody',
                    'Dynamic collections are extra columns on your dashboard. Each collection shows bookmarks that match rules you define — by tag, category, or keyboard shortcut.'
                ),
                selector: '[data-tab-content="collections"] .collections-tab',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
            },
            {
                title: this.t('configCollectionsTourListTitle', 'Your collections'),
                body: this.t(
                    'configCollectionsTourListBody',
                    'Saved collections appear here with their match logic (AND / OR) and rule count. Edit or delete any row — bookmarks themselves are never removed.'
                ),
                getTarget: () =>
                    document.getElementById('collections-list') ||
                    document.getElementById('collections-empty-state'),
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                title: this.t('configCollectionsTourAddTitle', 'New collection'),
                body: this.t(
                    'configCollectionsTourAddBody',
                    'Click + New collection to open the editor. Next we can pre-fill example rules for tag, category, and shortcut — only if you agree.'
                ),
                selector: '#add-collection-btn',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                id: 'demo-open',
                title: this.t('configCollectionsTourDemoTitle', 'Demo: rule editor'),
                body: this.t(
                    'configCollectionsTourDemoIntroBody',
                    'The fastest way to learn is a short demo collection with one rule per field type.'
                ),
                selector: '#add-collection-btn',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleDemoOpenStep(step),
            },
            {
                title: this.t('configCollectionsTourTagTitle', 'Rule: Tag'),
                body: this.t(
                    'configCollectionsTourTagBody',
                    'Tag — match bookmarks that have a tag (comma-separated on each bookmark). Example: tag includes “tour-demo”. Values are lowercased when saved.'
                ),
                getTarget: () => this.findRuleRow('tag'),
                scrollBlock: 'nearest',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: () => this.ensureEditPanelForRuleSteps(),
            },
            {
                title: this.t('configCollectionsTourCategoryTitle', 'Rule: Category'),
                body: this.t(
                    'configCollectionsTourCategoryBody',
                    'Category — match bookmarks in a category column. Use the category id (same as in Config → Categories), not the display name. Example: category includes your category id.'
                ),
                getTarget: () => this.findRuleRow('category'),
                scrollBlock: 'nearest',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: () => this.ensureEditPanelForRuleSteps(),
            },
            {
                title: this.t('configCollectionsTourShortcutTitle', 'Rule: Shortcut'),
                body: this.t(
                    'configCollectionsTourShortcutBody',
                    'Shortcut — match bookmarks with a keyboard shortcut letter. Example: shortcut includes “a”. Combine with OR logic so any matching rule is enough.'
                ),
                getTarget: () => this.findRuleRow('shortcut'),
                scrollBlock: 'nearest',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: () => this.ensureEditPanelForRuleSteps(),
            },
            {
                title: this.t('configCollectionsTourLogicTitle', 'Match logic'),
                body: this.t(
                    'configCollectionsTourLogicBody',
                    'AND requires every rule to match; OR includes bookmarks that match any rule. The demo uses OR so tag, category, or shortcut matches are enough.'
                ),
                getTarget: () => document.getElementById('col-edit-logic'),
                scrollBlock: 'nearest',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: () => this.ensureEditPanelForRuleSteps(),
            },
            {
                id: 'demo-save',
                title: this.t('configCollectionsTourSaveTitle', 'Save to dashboard'),
                body: this.t(
                    'configCollectionsTourSaveIntroBody',
                    'Click Save to store the collection. It appears on the dashboard for the current page when bookmarks match.'
                ),
                getTarget: () => document.getElementById('col-edit-save'),
                selector: null,
                scrollBlock: 'nearest',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleSaveStep(step),
            },
            {
                title: this.t('configCollectionsTourDashboardTitle', 'On the dashboard'),
                body: this.t(
                    'configCollectionsTourDashboardBody',
                    'Open the dashboard — matching collections show as extra columns next to your categories. Hover the column header to see which rules matched.'
                ),
                getTarget: () => this.findDashboardBackLink(),
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
            },
            {
                id: 'demo-cleanup',
                title: this.t('configCollectionsTourCleanupTitle', 'Clean up the demo'),
                body: this.t(
                    'configCollectionsTourCleanupIntroBody',
                    'To leave your library unchanged, we remove the temporary demo collection now. Confirm in the next dialog — same as deleting any collection.'
                ),
                getTarget: () =>
                    document.getElementById('collections-list') ||
                    document.getElementById('collections-empty-state'),
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleCleanupStep(step),
            },
        ];
    }

    async prepareAndStart({ force = false } = {}) {
        this.lastFailureReason = null;
        if (!this.canStart({ force })) {
            this.lastFailureReason = 'blocked';
            return false;
        }

        this.ensurePageReady();

        if (force) {
            ConfigCollectionsTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._demoCollectionId = null;
            this._demoOpenHandled = false;
            this._demoSaveHandled = false;
            this._demoCleanupHandled = false;
        }

        this.ensureCollectionsTabActive();
        await this.waitForCollectionsTabActive(force ? 50 : 30);
        const mgr = window.configManager;
        if (mgr?.collections && !mgr._configCollectionsTourActive) {
            mgr.collections.refresh(mgr);
        }
        await this.waitMs(force ? 120 : 80);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-collections-tab';
            return false;
        }
        if (!document.getElementById('collections-list')) {
            this.lastFailureReason = 'dom-not-ready';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-collections-tour-active', 'true');
        document.body.classList.remove('config-collections-tour-ready');
        window.GuidedFlowGuard?.syncModalOpenClass?.();
        if (window.configManager) {
            window.configManager._configCollectionsTourActive = true;
        }
        try {
            await this.showStep(0);
            document.body.classList.add('config-collections-tour-ready');
        } catch (error) {
            console.error('Config Collections tour failed to start', error);
            ConfigCollectionsTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    removeTourCardOnly() {
        document.querySelectorAll('.config-collections-tour-card').forEach((el) => el.remove());
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    render() {
        this.removeTourCardOnly();

        const card = document.createElement('div');
        card.className = 'config-collections-tour-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.innerHTML = `
            <div class="config-general-tour-progress"></div>
            <h3 class="config-general-tour-title"></h3>
            <p class="config-general-tour-body"></p>
            <div class="config-general-tour-actions">
                <button type="button" class="config-general-tour-btn config-general-tour-back"></button>
                <button type="button" class="config-general-tour-btn config-general-tour-skip"></button>
                <button type="button" class="config-general-tour-btn config-general-tour-next"></button>
            </div>
        `;
        document.body.appendChild(card);
        this.card = card;
        window.ConfigTourRuntime?.elevateTourCard?.(card);

        card.querySelector('.config-general-tour-back').textContent = this.t('configGeneralTourBack', 'Back');
        card.querySelector('.config-general-tour-skip').textContent = this.t('configGeneralTourSkip', 'Skip tour');
        card.querySelector('.config-general-tour-next').textContent = this.t('configGeneralTourNext', 'Next');

        card.querySelector('.config-general-tour-back').addEventListener('click', () => this.prevStep());
        card.querySelector('.config-general-tour-skip').addEventListener('click', () => this.finish());
        card.querySelector('.config-general-tour-next').addEventListener('click', () => this.nextStep());

        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.finish();
        };
        document.addEventListener('keydown', this.keyHandler);
    }

    updateStepContent(step, index) {
        if (!this.card || !step) return;

        const title = this.card.querySelector('.config-general-tour-title');
        const body = this.card.querySelector('.config-general-tour-body');
        const progress = this.card.querySelector('.config-general-tour-progress');
        const back = this.card.querySelector('.config-general-tour-back');
        const next = this.card.querySelector('.config-general-tour-next');

        if (!title || !body || !progress || !back || !next) return;

        title.textContent = step.title || '';
        body.textContent = step.body || '';
        if (step.title || step.body) {
            this._tourShown = true;
        }
        progress.textContent = this.t('configCollectionsTourProgress', 'Step {step} of {total}')
            .replace('{step}', String(index + 1))
            .replace('{total}', String(this.steps.length));

        back.disabled = index === 0;
        next.textContent =
            index === this.steps.length - 1
                ? this.t('configGeneralTourFinish', 'Finish')
                : this.t('configGeneralTourNext', 'Next');
    }

    clearHighlight() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('config-collections-tour-highlight');
            this.highlightedElement = null;
        }
    }

    async showStep(index) {
        this.currentStep = Math.max(0, Math.min(index, this.steps.length - 1));
        const step = this.steps[this.currentStep];
        if (!step || !this.card) return;

        const runId = ++this._stepRunId;
        const hadHighlight = Boolean(this.highlightedElement);

        if (hadHighlight) {
            this.clearHighlight();
            this.unlockScroll();
        }

        if (typeof step.onBeforeShow === 'function') {
            await step.onBeforeShow(step);
            if (runId !== this._stepRunId) return;
        }

        const element = this.revealTarget(step);
        await this.waitMs(80);
        if (runId !== this._stepRunId) return;

        if (element) {
            await this.scrollToStepTarget(element, step, { block: step.scrollBlock || 'center' });
            if (runId !== this._stepRunId) return;
            element.classList.add('config-collections-tour-highlight');
            this.highlightedElement = element;
        } else {
            this.lockScroll();
        }

        window.ConfigTourRuntime?.positionCardAtViewportBottom?.(this);

        if (runId !== this._stepRunId) return;
        this.updateStepContent(step, this.currentStep);
        window.ConfigTourRuntime?.elevateTourCard?.(this.card);
        window.GuidedFlowGuard?.syncModalOpenClass?.();
    }

    nextStep() {
        if (this.currentStep >= this.steps.length - 1) {
            this.finish();
            return;
        }
        void this.showStep(this.currentStep + 1);
    }

    prevStep() {
        void this.showStep(this.currentStep - 1);
    }

    async markCompleted() {
        try {
            localStorage.setItem(this.storageKey, '1');
        } catch {
            // ignore
        }
        try {
            await this.onMarkSeen?.();
        } catch {
            // ignore
        }
    }

    finish() {
        if (!this._tourShown) {
            void this.ensureDemoRemoved().finally(() => this.close());
            return;
        }
        void this.markCompleted().then(() => this.ensureDemoRemoved()).finally(() => this.close());
    }

    close() {
        this._stepRunId += 1;
        this._tourShown = false;
        this.clearHighlight();
        this.resetCardPosition();
        this.unlockScroll();

        if (window.configManager) {
            window.configManager._configCollectionsTourActive = false;
        }
        document.body.removeAttribute('data-config-collections-tour-active');
        document.body.classList.remove('config-collections-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        this.ensureCollectionsTabActive();
        window.configManager?.collections?.refresh?.(window.configManager);
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigCollectionsTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

if (typeof window !== 'undefined') {
    window.ConfigCollectionsTour = ConfigCollectionsTour;
}
