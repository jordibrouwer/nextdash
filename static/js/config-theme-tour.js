/**
 * One-time guided tour on Config → Theme (colors): create demo custom theme, save,
 * activate on General → Appearance, then remove the demo.
 */
class ConfigThemeTour {
    static STORAGE_KEY = 'nextdash:config-theme-tour-v1';
    static DEMO_FLAG = '_configThemeTourDemo';

    constructor({ language, hasSeen, onMarkSeen } = {}) {
        this.language = language;
        this.hasSeen = typeof hasSeen === 'function' ? hasSeen : null;
        this.onMarkSeen = typeof onMarkSeen === 'function' ? onMarkSeen : null;
        this.storageKey = ConfigThemeTour.STORAGE_KEY;
        this.steps = [];
        this.currentStep = 0;
        this.card = null;
        this.highlightedElement = null;
        this.keyHandler = null;
        this._stepRunId = 0;
        this._tourShown = false;
        this.lastFailureReason = null;
        this._lockedScrollY = null;
        this._demoThemeId = null;
        this._previousTheme = null;
        this._demoAddHandled = false;
        this._demoSaveHandled = false;
        this._demoSelectHandled = false;
        this._demoCleanupHandled = false;
        this._demoCleanupInProgress = false;
        this._tourDialogDepth = 0;
    }

    static getBlockReason({ force = false, hasSeen = null } = {}) {
        if (typeof window.ConfigThemeTour !== 'function') return 'missing-script';
        if (!force && typeof hasSeen === 'function' && hasSeen()) return 'completed';
        if (!force && window.MobileExperience?.shouldSkipHeavyUi?.()) return 'mobile';
        if (!document.querySelector('[data-tab-content="colors"]')) return 'no-colors-tab';
        return null;
    }

    t(key, fallback) {
        const full = `config.${key}`;
        if (!this.language || typeof this.language.t !== 'function') return fallback;
        const raw = this.language.t(full);
        return raw && raw !== full ? raw : fallback;
    }

    demoThemeName() {
        return this.t('configThemeTourDemoName', 'Tour demo');
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
        if (!document.querySelector('[data-tab-content="colors"]')) return false;
        return true;
    }

    static teardownStaleDom() {
        document.querySelectorAll('.config-theme-tour-card').forEach((el) => el.remove());
        document.body.removeAttribute('data-config-theme-tour-active');
        document.body.classList.remove('config-theme-tour-ready');
        document.documentElement.classList.remove('config-theme-tour-scroll-lock');
        document.body.classList.remove('config-theme-tour-scroll-lock');
        document.body.style.top = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document
            .querySelectorAll('.config-theme-tour-highlight')
            .forEach((el) => el.classList.remove('config-theme-tour-highlight'));
        document.body.classList.remove('config-theme-tour-dialog-open');
        if (window.configManager) {
            window.configManager._configThemeTourActive = false;
        }
    }

    ensureColorsTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('colors');
        } else {
            document.querySelector('.tab-button[data-tab="colors"]')?.click();
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash.startsWith('colors')) {
            window.history.replaceState(null, '', '#colors');
        }
    }

    ensureGeneralTabActive() {
        const mgr = window.configManager;
        if (mgr?.ui?.switchToTab) {
            mgr.ui.switchToTab('general');
        } else {
            document.querySelector('.tab-button[data-tab="general"]')?.click();
        }
        const hash = (window.location.hash || '').replace(/^#/, '');
        if (!hash.startsWith('general')) {
            window.history.replaceState(null, '', '#general');
            mgr?.generalLayers?.applyHash?.('#general');
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

    async waitForColorsTabActive(maxAttempts = 45) {
        for (let left = maxAttempts; left > 0; left -= 1) {
            this.ensureColorsTabActive();
            const panel = document.querySelector('[data-tab-content="colors"]');
            const editor = document.getElementById('theme-colors-editor');
            if (panel && editor && (panel.classList.contains('active') || left <= 8)) {
                return true;
            }
            await this.waitMs(80);
        }
        return Boolean(
            document.querySelector('[data-tab-content="colors"]') &&
                document.getElementById('theme-colors-editor')
        );
    }

    async ensureColorsEditorReady() {
        const mgr = window.configManager;
        if (!mgr?.ensureColorsEditor) return false;
        try {
            await mgr.ensureColorsEditor();
            const editor = mgr.colorsEditor;
            if (editor?.switchSubTab) {
                editor.switchSubTab('custom', { updateHash: true });
            }
            await this.waitMs(80);
            return Boolean(document.getElementById('custom-themes-list'));
        } catch (error) {
            console.warn('Theme tour: colors editor not ready', error);
            return false;
        }
    }

    waitMs(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    lockScroll() {
        if (document.documentElement.classList.contains('config-theme-tour-scroll-lock')) return;
        this._lockedScrollY = window.scrollY;
        document.documentElement.classList.add('config-theme-tour-scroll-lock');
        document.body.classList.add('config-theme-tour-scroll-lock');
        document.body.style.top = `-${this._lockedScrollY}px`;
    }

    unlockScroll() {
        const y = this._lockedScrollY;
        document.documentElement.classList.remove('config-theme-tour-scroll-lock');
        document.body.classList.remove('config-theme-tour-scroll-lock');
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
        this.card.style.removeProperty('right');
        this.card.style.removeProperty('transform');
    }

    positionCardAtViewportBottom() {
        if (!this.card) return;
        this.resetCardPosition();
    }

    isOversizedHighlight(element) {
        const rect = element?.getBoundingClientRect();
        if (!rect || rect.height < 1) return false;
        return (
            rect.height > window.innerHeight * 0.52 ||
            rect.width > window.innerWidth * 0.78
        );
    }

    beginTourDialog() {
        this._tourDialogDepth = (this._tourDialogDepth || 0) + 1;
        if (this._tourDialogDepth > 1) return;
        this.positionCardAtViewportBottom();
        this.card?.classList.add('is-suppressed-for-dialog');
        document.body.classList.add('config-theme-tour-dialog-open');
    }

    endTourDialog() {
        this._tourDialogDepth = Math.max(0, (this._tourDialogDepth || 1) - 1);
        if (this._tourDialogDepth > 0) return;
        document.body.classList.remove('config-theme-tour-dialog-open');
        this.card?.classList.remove('is-suppressed-for-dialog');
    }

    async withTourDialog(fn) {
        this.beginTourDialog();
        try {
            return await fn();
        } finally {
            this.endTourDialog();
        }
    }

    getColorsEditor() {
        return window.configManager?.colorsEditor || null;
    }

    findDemoTheme() {
        const editor = this.getColorsEditor();
        if (!editor?.colorsData?.custom) return null;
        if (this._demoThemeId && editor.colorsData.custom[this._demoThemeId]) {
            return editor.colorsData.custom[this._demoThemeId];
        }
        return Object.entries(editor.colorsData.custom).find(([, t]) => t[ConfigThemeTour.DEMO_FLAG])?.[1] || null;
    }

    findDemoThemeId() {
        const editor = this.getColorsEditor();
        if (!editor?.colorsData?.custom) return this._demoThemeId;
        if (this._demoThemeId && editor.colorsData.custom[this._demoThemeId]) {
            return this._demoThemeId;
        }
        const entry = Object.entries(editor.colorsData.custom).find(([, t]) => t[ConfigThemeTour.DEMO_FLAG]);
        return entry ? entry[0] : null;
    }

    findDemoThemeElement() {
        const id = this.findDemoThemeId();
        if (!id) return null;
        try {
            return document.querySelector(`[data-theme-id="${CSS.escape(id)}"]`);
        } catch {
            return document.querySelector(`[data-theme-id="${id}"]`);
        }
    }

    async addTourDemoTheme() {
        const mgr = window.configManager;
        const editor = this.getColorsEditor();
        if (!editor?.customThemesManager) return false;

        if (!this._previousTheme) {
            this._previousTheme = mgr?.settingsData?.theme || 'dark';
        }

        const existingId = this.findDemoThemeId();
        if (existingId) {
            this._demoThemeId = existingId;
            const theme = editor.colorsData.custom[existingId];
            theme.name = this.demoThemeName();
            theme[ConfigThemeTour.DEMO_FLAG] = true;
            theme.accentSuccess = theme.accentSuccess || '#d946ef';
            editor.customThemesManager.render(editor.colorsData.custom);
            editor.customThemesManager.updateThemeSelector(editor.colorsData.custom);
            const selector = editor.root?.querySelector('#custom-theme-selector');
            if (selector) {
                selector.value = existingId;
                editor.customThemesManager.currentSelectedTheme = existingId;
                editor.customThemesManager.showThemeColors(theme);
                editor.currentPreviewTheme = 'custom';
                editor.applyColorsToPreview();
                selector.__customSelectInstance?.refresh?.();
            }
            return true;
        }

        if (!editor.colorsData.custom || typeof editor.colorsData.custom !== 'object') {
            editor.colorsData.custom = {};
        }

        const starter =
            (editor.colorsData.builtIn && editor.colorsData.builtIn['cherry-graphite-dark']) ||
            editor.colorsData.dark ||
            editor.colorsData.light ||
            {};

        const themeId = editor.customThemesManager.generateUniqueId();
        editor.colorsData.custom[themeId] = {
            ...starter,
            name: this.demoThemeName(),
            accentSuccess: '#d946ef',
            [ConfigThemeTour.DEMO_FLAG]: true,
        };
        this._demoThemeId = themeId;

        editor.customThemesManager.render(editor.colorsData.custom);
        editor.customThemesManager.updateThemeSelector(editor.colorsData.custom);
        const selector = editor.root?.querySelector('#custom-theme-selector');
        if (selector) {
            selector.value = themeId;
            editor.customThemesManager.currentSelectedTheme = themeId;
            editor.customThemesManager.showThemeColors(editor.colorsData.custom[themeId]);
            editor.currentPreviewTheme = 'custom';
            editor.applyColorsToPreview();
            selector.__customSelectInstance?.refresh?.();
        }
        editor.switchSubTab?.('custom', { updateHash: true });
        editor.markDirty();
        await editor.autosaveThemeStructure();
        return true;
    }

    async saveDemoThemeColors() {
        const editor = this.getColorsEditor();
        if (!editor) return false;
        try {
            await editor.saveColors();
            return true;
        } catch {
            return false;
        }
    }

    async selectDemoThemeOnGeneral() {
        const mgr = window.configManager;
        const themeId = this.findDemoThemeId();
        if (!themeId || !mgr?.settings) return false;

        this.ensureGeneralTabActive();
        await this.waitMs(120);

        try {
            await mgr.settings.loadCustomThemes();
            mgr.settings.populateThemeSelect();
        } catch {
            // ignore
        }

        const themeSelect = document.getElementById('theme-select');
        if (!themeSelect) return false;

        const hasOption = [...themeSelect.options].some((o) => o.value === themeId);
        if (!hasOption) return false;

        themeSelect.value = themeId;
        themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await this.waitMs(80);
        return mgr.settingsData?.theme === themeId;
    }

    async removeTourDemoTheme() {
        if (this._demoCleanupInProgress) return false;
        const mgr = window.configManager;
        const editor = this.getColorsEditor();
        const themeId = this.findDemoThemeId();
        if (!themeId || !editor?.colorsData?.custom?.[themeId]) {
            this._demoThemeId = null;
            return true;
        }

        this._demoCleanupInProgress = true;
        try {
            const activeTheme = mgr?.settingsData?.theme;
            if (activeTheme === themeId && this._previousTheme) {
                const themeSelect = document.getElementById('theme-select');
                if (themeSelect) {
                    const restore = [...themeSelect.options].some((o) => o.value === this._previousTheme)
                        ? this._previousTheme
                        : 'dark';
                    themeSelect.value = restore;
                    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    await this.waitMs(60);
                }
            }

            delete editor.colorsData.custom[themeId];
            if (editor.customThemesManager?.currentSelectedTheme === themeId) {
                editor.customThemesManager.currentSelectedTheme = null;
                editor.customThemesManager.hideThemeColors();
            }
            this._demoThemeId = null;

            editor.customThemesManager.render(editor.colorsData.custom);
            editor.customThemesManager.updateThemeSelector(editor.colorsData.custom);
            const selector = editor.root?.querySelector('#custom-theme-selector');
            if (selector) {
                selector.value = '';
                selector.__customSelectInstance?.refresh?.();
            }
            document.getElementById('color-preview-style')?.remove();

            await editor.autosaveThemeStructure();
            if (mgr?.settings) {
                await mgr.settings.loadCustomThemes();
                mgr.settings.populateThemeSelect();
            }
            return true;
        } catch (error) {
            console.warn('Theme tour: cleanup failed', error);
            return false;
        } finally {
            this._demoCleanupInProgress = false;
        }
    }

    async ensureDemoRemoved() {
        if (!this.findDemoThemeId()) return true;
        return this.removeTourDemoTheme();
    }

    async handleDemoAddStep(step) {
        if (this._demoAddHandled) return;
        this._demoAddHandled = true;

        const added = await this.addTourDemoTheme();
        if (added) {
            step.body = this.t(
                'configThemeTourDemoAddedBody',
                'We created “Tour demo” with a distinct accent color. You can rename it in the list — it is saved to disk after the next step.'
            );
            step.getTarget = () => this.findDemoThemeElement() || document.getElementById('add-custom-theme-btn');
            step.selector = null;
        } else {
            step.body = this.t(
                'configThemeTourDemoFailedBody',
                'Click Add Custom Theme to create a palette, then continue the tour.'
            );
            step.selector = '#add-custom-theme-btn';
            step.getTarget = null;
        }
    }

    async handlePreviewStep(step) {
        const editor = this.getColorsEditor();
        const themeId = this.findDemoThemeId();
        if (editor && themeId) {
            const selector = editor.root?.querySelector('#custom-theme-selector');
            if (selector && selector.value !== themeId) {
                selector.value = themeId;
                editor.customThemesManager.currentSelectedTheme = themeId;
                editor.customThemesManager.showThemeColors(editor.colorsData.custom[themeId]);
                editor.applyColorsToPreview();
            }
        }
        step.getTarget = () =>
            document.getElementById('theme-preview-card') ||
            document.getElementById('custom-theme-colors-section') ||
            document.getElementById('custom-themes-list');
        step.selector = null;
    }

    async handleSaveStep(step) {
        if (this._demoSaveHandled) return;
        this._demoSaveHandled = true;

        const saved = await this.saveDemoThemeColors();
        if (saved) {
            step.body = this.t(
                'configThemeTourSaveDoneBody',
                'Your custom theme is saved. It now appears in General → Appearance. Next we switch there to activate it.'
            );
        } else {
            step.body = this.t(
                'configThemeTourSaveFailBody',
                'Click Save colors to write your custom theme to disk before continuing.'
            );
        }
    }

    async handleGeneralHandoffStep(step) {
        this.ensureGeneralTabActive();
        await this.waitMs(100);
        mgrRefreshCustomSelects();
        step.getTarget = () => document.querySelector('.form-group--theme-select') || document.getElementById('theme-select');
        step.selector = null;
        step.body = this.t(
            'configThemeTourGeneralHandoffBody',
            'Saved themes are picked here under Theme. We pre-select the tour demo so you can see it live on Config and the dashboard.'
        );
    }

    async handleSelectThemeStep(step) {
        if (this._demoSelectHandled) return;
        this._demoSelectHandled = true;

        const selected = await this.selectDemoThemeOnGeneral();
        if (selected) {
            step.body = this.t(
                'configThemeTourSelectDoneBody',
                '“Tour demo” is now your active theme. The dashboard uses it immediately — we remove it at the end of the tour.'
            );
        } else {
            step.body = this.t(
                'configThemeTourSelectFailBody',
                'Choose “Tour demo” in the Theme dropdown to apply your new palette.'
            );
        }
        step.getTarget = () => document.querySelector('.form-group--theme-select') || document.getElementById('theme-select');
        step.selector = null;
    }

    async handleCleanupStep(step) {
        if (this._demoCleanupHandled) return;
        this._demoCleanupHandled = true;

        if (!this.findDemoThemeId()) {
            step.body = this.t(
                'configThemeTourCleanupNoneBody',
                'No demo theme remains. Custom themes you create here are always listed under General → Theme after saving.'
            );
            return;
        }

        let confirmed = true;
        try {
            confirmed = await this.withTourDialog(async () => {
                if (window.AppModal?.confirm) {
                    return await window.AppModal.confirm({
                        title: this.t('configThemeTourCleanupConfirmTitle', 'Remove the demo theme?'),
                        message: this.t(
                            'configThemeTourCleanupConfirmMessage',
                            'We remove the temporary “Tour demo” theme and restore your previous theme selection.'
                        ),
                        confirmText: this.t('configThemeTourCleanupConfirmYes', 'Remove demo'),
                        cancelText: this.t('config.cancel', 'Cancel'),
                    });
                }
                return window.confirm(
                    this.t(
                        'configThemeTourCleanupConfirmMessage',
                        'Remove the tour demo theme?'
                    )
                );
            });
        } catch {
            confirmed = false;
        }

        if (!confirmed) {
            step.body = this.t(
                'configThemeTourCleanupKeptBody',
                'The demo theme may still be present. Delete it on the Theme tab or restart the tour from General → System tools.'
            );
            return;
        }

        const removed = await this.removeTourDemoTheme();
        this.ensureColorsTabActive();
        await this.ensureColorsEditorReady();

        step.body = removed
            ? this.t(
                  'configThemeTourCleanupDoneBody',
                  'The demo theme is removed and your previous theme is restored. Your own custom themes are unchanged.'
              )
            : this.t(
                  'configThemeTourCleanupFailBody',
                  'Could not remove the demo theme automatically. Delete “Tour demo” in Custom themes on the Theme tab.'
              );
        step.getTarget = () => document.getElementById('custom-themes-list');
        step.selector = null;
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

    positionCardNearTarget(element, step = {}) {
        if (!this.card) return;
        if (!element) {
            this.positionCardAtViewportBottom();
            return;
        }

        const placement = step.cardPlacement || 'auto';
        if (placement === 'viewport-bottom' || (placement === 'auto' && this.isOversizedHighlight(element))) {
            this.positionCardAtViewportBottom();
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
        }

        const maxLeft = Math.max(viewportPadding, window.innerWidth - cardW - viewportPadding);
        const centeredLeft = targetRect.left + targetRect.width / 2 - cardW / 2;
        const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));

        let top;
        if (placeAbove) {
            top = Math.max(headerClearance + viewportPadding, targetRect.top - cardH - gap);
        } else {
            top = Math.min(window.innerHeight - cardH - viewportPadding, targetRect.bottom + gap);
        }

        this.card.classList.add('is-docked');
        this.card.style.left = `${Math.round(left)}px`;
        this.card.style.top = `${Math.round(top)}px`;
        this.card.style.bottom = 'auto';
        this.card.style.transform = 'none';
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

    async scrollToStepTarget(element, step = {}) {
        if (!element || typeof element.scrollIntoView !== 'function') return;

        this.unlockScroll();

        const block = step.scrollBlock || 'center';
        const scrollParent = this.getScrollableAncestor(element);
        const scrollTarget = element.closest('.theme-colors-toolbar') || element;
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
        }

        this.positionCardNearTarget(element, step);
        await this.waitMs(8);
        this.lockScroll();
    }

    buildSteps() {
        return [
            {
                title: this.t('configThemeTourWelcomeTitle', 'Welcome to Theme'),
                body: this.t(
                    'configThemeTourWelcomeBody',
                    'Fine-tune built-in palettes or create custom themes here. This tour adds a temporary demo theme, saves it, activates it on General, then removes it.'
                ),
                selector: '#theme-colors-editor',
                scrollBlock: 'start',
                cardPlacement: 'viewport-bottom',
            },
            {
                title: this.t('configThemeTourSubtabsTitle', 'Dark, light & custom'),
                body: this.t(
                    'configThemeTourSubtabsBody',
                    'Switch between default dark/light palettes and your own custom themes. We work in Custom themes for this demo.'
                ),
                selector: '.colors-subtabs',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                title: this.t('configThemeTourAddTitle', 'Add a custom theme'),
                body: this.t(
                    'configThemeTourAddIntroBody',
                    'Click Add Custom Theme to start from the default starter colors. Next we create one for you automatically.'
                ),
                selector: '#add-custom-theme-btn',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
            },
            {
                id: 'demo-add',
                title: this.t('configThemeTourDemoTitle', 'Demo custom theme'),
                body: this.t(
                    'configThemeTourDemoIntroBody',
                    'We add a theme named “Tour demo” with a magenta accent so you can spot it in the list and preview.'
                ),
                selector: '#custom-themes-list',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleDemoAddStep(step),
            },
            {
                id: 'demo-preview',
                title: this.t('configThemeTourPreviewTitle', 'Live preview'),
                body: this.t(
                    'configThemeTourPreviewIntroBody',
                    'The preview card shows how bookmarks and controls look with your palette. Adjust colors anytime before saving.'
                ),
                selector: '#theme-preview-card',
                scrollBlock: 'nearest',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handlePreviewStep(step),
            },
            {
                id: 'demo-save',
                title: this.t('configThemeTourSaveTitle', 'Save colors'),
                body: this.t(
                    'configThemeTourSaveIntroBody',
                    'Save colors writes custom themes to disk so they appear in General → Theme and on the dashboard.'
                ),
                selector: '#save-colors-btn',
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleSaveStep(step),
            },
            {
                id: 'general-handoff',
                title: this.t('configThemeTourGeneralTitle', 'Activate on General'),
                body: this.t(
                    'configThemeTourGeneralIntroBody',
                    'Switch to General → Appearance to choose which theme is active across the app.'
                ),
                getTarget: () => document.querySelector('.tab-button[data-tab="general"]'),
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleGeneralHandoffStep(step),
            },
            {
                id: 'demo-select',
                title: this.t('configThemeTourSelectTitle', 'Theme dropdown'),
                body: this.t(
                    'configThemeTourSelectIntroBody',
                    'Custom themes appear in this list after you save them on the Theme tab. We apply the tour demo now.'
                ),
                getTarget: () => document.querySelector('.form-group--theme-select') || document.getElementById('theme-select'),
                scrollBlock: 'center',
                cardPlacement: 'viewport-bottom',
                onBeforeShow: (step) => this.handleSelectThemeStep(step),
            },
            {
                id: 'demo-cleanup',
                title: this.t('configThemeTourCleanupTitle', 'Clean up the demo'),
                body: this.t(
                    'configThemeTourCleanupIntroBody',
                    'Remove the temporary theme and restore your previous selection so nothing stays behind.'
                ),
                selector: '#custom-themes-list',
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
            ConfigThemeTour.teardownStaleDom();
            this.card = null;
            this.highlightedElement = null;
            this._demoThemeId = null;
            this._previousTheme = null;
            this._demoAddHandled = false;
            this._demoSaveHandled = false;
            this._demoSelectHandled = false;
            this._demoCleanupHandled = false;
        }

        this.ensureColorsTabActive();
        await this.waitForColorsTabActive(force ? 50 : 30);
        await this.ensureColorsEditorReady();
        await this.waitMs(force ? 120 : 80);

        if (!this.canStart({ force })) {
            this.lastFailureReason = 'no-colors-tab';
            return false;
        }

        this.steps = this.buildSteps();
        this.render();
        if (!this.card) {
            this.lastFailureReason = 'render-failed';
            return false;
        }

        document.body.setAttribute('data-config-theme-tour-active', 'true');
        document.body.classList.add('config-theme-tour-ready');
        if (window.configManager) {
            window.configManager._configThemeTourActive = true;
        }
        try {
            await this.showStep(0);
        } catch (error) {
            console.error('Config Theme tour failed to start', error);
            ConfigThemeTour.teardownStaleDom();
            this.lastFailureReason = 'step-error';
            return false;
        }
        return true;
    }

    removeTourCardOnly() {
        document.querySelectorAll('.config-theme-tour-card').forEach((el) => el.remove());
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    render() {
        this.removeTourCardOnly();

        const card = document.createElement('div');
        card.className = 'config-theme-tour-card';
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
        card.querySelector('.config-general-tour-skip').addEventListener('click', () => {
            window.ConfigTourRuntime?.skipConfigTour?.(this);
        });
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
        progress.textContent = this.t('configThemeTourProgress', 'Step {step} of {total}')
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
            this.highlightedElement.classList.remove('config-theme-tour-highlight');
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

        if (step.cardPlacement === 'viewport-bottom') {
            this.positionCardAtViewportBottom();
        }

        if (typeof step.onBeforeShow === 'function') {
            await step.onBeforeShow(step);
            if (runId !== this._stepRunId) return;
        }

        const element = this.revealTarget(step);
        await this.waitMs(80);
        if (runId !== this._stepRunId) return;

        if (element) {
            await this.scrollToStepTarget(element, step);
            if (runId !== this._stepRunId) return;
            element.classList.add('config-theme-tour-highlight');
            this.highlightedElement = element;
        } else {
            this.positionCardAtViewportBottom();
            this.lockScroll();
        }

        if (runId !== this._stepRunId) return;
        this.updateStepContent(step, this.currentStep);
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

    finish({ skipped = false } = {}) {
        if (!skipped && !this._tourShown) {
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
        this.endTourDialog();

        if (window.configManager) {
            window.configManager._configThemeTourActive = false;
        }
        document.body.removeAttribute('data-config-theme-tour-active');
        document.body.classList.remove('config-theme-tour-ready');
        this.card?.remove();
        this.card = null;
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    }

    static resetSeen() {
        try {
            localStorage.removeItem(ConfigThemeTour.STORAGE_KEY);
        } catch {
            // ignore
        }
    }
}

function mgrRefreshCustomSelects() {
    try {
        window.configManager?.refreshCustomSelects?.();
    } catch {
        // ignore
    }
}

if (typeof window !== 'undefined') {
    window.ConfigThemeTour = ConfigThemeTour;
}
