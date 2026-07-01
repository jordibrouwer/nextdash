/**
 * Onboarding, feature tours, post-onboarding prompts.
 */
class DashboardPromos {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    canShowPostOnboardingPrompts() {
        const d = this.dash;
        if (window.DashboardPromoRegistry?.areDiscoverabilityPromosPaused?.()) return false;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (d.onboardingStartedInSession) return false;
        if (!d.settings?.onboardingCompleted) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        return true;
    }


    shouldShowWhatsNewPrompt() {
        const d = this.dash;
        if (typeof window.openWhatsNewModal !== 'function') return false;
        try {
            const release = window.NEXTDASH_WHATS_NEW_RELEASE;
            const lastSeen = localStorage.getItem('nextdash:last-whats-new-dashboard-release');
            if (release && lastSeen === release) return false;
            if (!release && lastSeen) return false;
        } catch {
            return false;
        }
        return true;
    }


    shouldShowLayoutNudgePrompt() {
        const d = this.dash;
        if (window.DashboardPromoRegistry?.isAutoPromoDisabled?.('layoutVersionNudge')) return false;
        return window.LayoutVersionNudge?.shouldOffer?.(d) === true;
    }


    shouldShowPasteSpotlightPrompt() {
        const d = this.dash;
        if (window.DashboardPromoRegistry?.isAutoPromoDisabled?.('pasteSpotlight')) return false;
        if (typeof window.FeatureSpotlight !== 'function') return false;
        if (d.settings?.pasteUrlQuickAdd === false) return false;
        if (window.matchMedia?.('(pointer: coarse)').matches) return false;
        try {
            if (localStorage.getItem(window.FeatureSpotlight.DEFAULT_STORAGE_KEY)) return false;
        } catch {
            return false;
        }
        return true;
    }


    schedulePostOnboardingPrompts(options = {}) {
        const d = this.dash;
        clearTimeout(d._postOnboardingPromptsTimer);
        let delay = 900;
        if (options.afterOnboarding) delay = 600;
        else if (Number.isFinite(options.delay)) delay = options.delay;
        if (options.resetAttempts === true) {
            d._postOnboardingPromptsAttempts = 0;
            d._postOnboardingWhatsNewAbortAttempts = 0;
        }
        const payload = {
            delay: undefined,
            afterOnboarding: false,
            skipWhatsNew: options.skipWhatsNew === true,
            skipLayoutNudge: options.skipLayoutNudge === true,
            skipPasteSpotlight: options.skipPasteSpotlight === true,
            skipPreviewCardSpotlight: options.skipPreviewCardSpotlight === true,
        };
        d._postOnboardingPromptsTimer = setTimeout(() => {
            this.runPostOnboardingPrompts(payload);
        }, delay);
    }


    runPostOnboardingPrompts(options = {}) {
        const d = this.dash;
        const skipWhatsNew = options.skipWhatsNew === true;
        const skipLayoutNudge = options.skipLayoutNudge === true;
        const skipPasteSpotlight = options.skipPasteSpotlight === true;
        const skipPreviewCardSpotlight = options.skipPreviewCardSpotlight === true;
        const maxWaitAttempts = 50;

        if (!this.canShowPostOnboardingPrompts()) {
            d._postOnboardingPromptsAttempts = (d._postOnboardingPromptsAttempts || 0) + 1;
            if (d._postOnboardingPromptsAttempts < maxWaitAttempts) {
                this.schedulePostOnboardingPrompts({
                    delay: 600,
                    skipWhatsNew,
                    skipLayoutNudge,
                    skipPasteSpotlight,
                    skipPreviewCardSpotlight,
                });
                return;
            }
            d._postOnboardingPromptsAttempts = 0;
            return;
        }
        d._postOnboardingPromptsAttempts = 0;

        if (!skipWhatsNew && this.shouldShowWhatsNewPrompt()) {
            window.openWhatsNewModal({
                force: false,
                ifBlockingModalOpen: () => !this.canShowPostOnboardingPrompts(),
                onClose: () => {
                    d._postOnboardingWhatsNewAbortAttempts = 0;
                    this.schedulePostOnboardingPrompts({
                        delay: 1200,
                        skipWhatsNew: true,
                    });
                },
                onAbort: () => {
                    const abortAttempts = (d._postOnboardingWhatsNewAbortAttempts || 0) + 1;
                    d._postOnboardingWhatsNewAbortAttempts = abortAttempts;
                    if (abortAttempts >= 20) {
                        d._postOnboardingWhatsNewAbortAttempts = 0;
                        this.schedulePostOnboardingPrompts({
                            delay: 1200,
                            skipWhatsNew: true,
                            skipLayoutNudge,
                        });
                        return;
                    }
                    this.schedulePostOnboardingPrompts({
                        delay: 600,
                        skipWhatsNew: false,
                        skipLayoutNudge,
                    });
                },
            });
            return;
        }

        if (!skipLayoutNudge && this.shouldShowLayoutNudgePrompt()) {
            const started = this.maybeShowLayoutModernNudge({
                onDismiss: () => this.schedulePostOnboardingPrompts({
                    delay: 1200,
                    skipWhatsNew: true,
                    skipLayoutNudge: true,
                }),
            });
            if (started) return;
        }

        if (!skipPasteSpotlight && this.shouldShowPasteSpotlightPrompt()) {
            this.maybeShowPasteSpotlight({
                onDismiss: () => this.schedulePostOnboardingPrompts({
                    delay: 1200,
                    skipWhatsNew: true,
                    skipLayoutNudge: true,
                    skipPasteSpotlight: true,
                }),
            });
            return;
        }

        if (!options.skipPreviewCardSpotlight && this.shouldShowPreviewCardSpotlightPrompt()) {
            this.maybeShowPreviewCardSpotlight();
        }
    }


    shouldShowPreviewCardSpotlightPrompt() {
        const d = this.dash;
        if (window.DashboardPromoRegistry?.isAutoPromoDisabled?.('previewCardSpotlight')) return false;
        return window.PreviewCardSpotlight?.shouldOffer?.(d) === true;
    }


    maybeShowPreviewCardSpotlight(options = {}) {
        const d = this.dash;
        if (!this.shouldShowPreviewCardSpotlightPrompt()) return false;
        if (!this.canShowPostOnboardingPrompts()) return false;

        const spotlight = window.PreviewCardSpotlight?.create?.(d, {
            onDismiss: () => {
                if (d.previewCardSpotlight === spotlight) {
                    d.previewCardSpotlight = null;
                }
                if (typeof options.onDismiss === 'function') {
                    options.onDismiss();
                }
            },
        });
        if (!spotlight) return false;

        const started = spotlight.show(1400, {
            canShow: () => window.PreviewCardSpotlight?.canShowNow?.(d) === true,
        });
        if (!started) return false;
        d.previewCardSpotlight = spotlight;
        return true;
    }


    maybeShowPasteSpotlight(options = {}) {
        const d = this.dash;
        if (!this.shouldShowPasteSpotlightPrompt()) return false;
        if (!this.canShowPostOnboardingPrompts()) return false;

        const onDismiss = typeof options.onDismiss === 'function' ? options.onDismiss : null;
        const spotlight = new window.FeatureSpotlight({
            language: d.language,
            onTry: () => {
                const handler = d.searchComponent?.commandsComponent?.newCommandHandler;
                if (handler) handler.openModal();
            },
            onDismiss: () => {
                if (d.pasteSpotlight === spotlight) {
                    d.pasteSpotlight = null;
                }
                onDismiss?.();
            },
        });
        const started = spotlight.show(1400, {
            canShow: () => this.canShowPostOnboardingPrompts(),
        });
        if (!started) return false;
        d.pasteSpotlight = spotlight;
        return true;
    }


    maybeShowLayoutModernNudge(options = {}) {
        const d = this.dash;
        if (!this.shouldShowLayoutNudgePrompt()) return false;
        if (!this.canShowPostOnboardingPrompts()) return false;

        const spotlight = window.LayoutVersionNudge.create(d);
        if (!spotlight) return false;

        const onDismiss = typeof options.onDismiss === 'function' ? options.onDismiss : null;
        spotlight.onDismiss = () => {
            d.layoutVersionNudge = null;
            d.layoutModernNudge = null;
            onDismiss?.();
        };

        const started = spotlight.show(800, {
            canShow: () => {
                if (!this.shouldShowLayoutNudgePrompt()) return false;
                return this.canShowPostOnboardingPrompts();
            },
        });
        if (!started) return false;
        d.layoutVersionNudge = spotlight;
        d.layoutModernNudge = spotlight;
        return true;
    }


    maybeShowWhatsNew() {
        const d = this.dash;
        if (!this.canShowPostOnboardingPrompts() || !this.shouldShowWhatsNewPrompt()) return;
        this.showWhatsNewModal({ force: false });
    }


    showWhatsNewModal(options = {}) {
        const d = this.dash;
        if (typeof window.openWhatsNewModal !== 'function') {
            return;
        }
        const force = options.force === true;
        window.openWhatsNewModal({
            force,
            ifBlockingModalOpen: force ? undefined : () => d.isModalOpen()
        });
    }


    initializeOnboarding() {
        const d = this.dash;
        if (typeof window.Onboarding !== 'function') {
            d.onboardingStartedInSession = false;
            return;
        }
        const allBookmarks = Array.isArray(d.allBookmarks) ? d.allBookmarks : [];
        const onboarding = new window.Onboarding({
            hasBookmarks: allBookmarks.length > 0 || (Array.isArray(d.bookmarks) && d.bookmarks.length > 0),
            pagesCount: Array.isArray(d.pages) ? d.pages.length : 1,
            pages: d.pages,
            bookmarks: d.bookmarks,
            allBookmarks,
            serverCompleted: d.settings?.onboardingCompleted === true,
            settings: d.settings,
            language: d.language,
            mobileCompact: window.MobileExperience?.shouldSkipHeavyUi?.() === true,
            onApplySettings: (nextSettings) => {
                d.settings = nextSettings;
                d.setupDOM();
                d.initializeAutoDarkMode();
                d.renderPageNavigation();
                d.renderDashboard();
                d.updateSearchComponent();
            },
            onApplyBookmarks: async (selection, meta = {}) => {
                if (!selection || typeof selection !== 'object') return;

                const applyCheckStatus = (bookmark) => {
                    if (!bookmark?.url || !(bookmark.url in selection)) {
                        return { ...bookmark };
                    }
                    return { ...bookmark, checkStatus: selection[bookmark.url] === true };
                };

                try {
                    if (meta.scope === 'all' && Array.isArray(d.allBookmarks) && d.allBookmarks.length > 0) {
                        const merged = d.allBookmarks.map(applyCheckStatus);
                        const byPage = new Map();
                        merged.forEach((bookmark) => {
                            const pageId = String(bookmark.pageId ?? d.currentPageId);
                            if (!byPage.has(pageId)) byPage.set(pageId, []);
                            byPage.get(pageId).push(bookmark);
                        });
                        for (const [pageId, pageBookmarks] of byPage) {
                            const response = await dashFetch(`/api/bookmarks?page=${pageId}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(pageBookmarks),
                            });
                            if (!response.ok) return;
                        }
                        d.allBookmarks = merged;
                        d.bookmarks = byPage.get(String(d.currentPageId)) || d.bookmarks;
                    } else {
                        const updatedBookmarks = d.bookmarks.map(applyCheckStatus);
                        const response = await dashFetch(`/api/bookmarks?page=${d.currentPageId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updatedBookmarks),
                        });
                        if (!response.ok) return;
                        d.bookmarks = updatedBookmarks;
                        if (d.settings.globalShortcuts) {
                            await d.loadAllBookmarks();
                        }
                    }
                    d.renderDashboard();
                    d.updateStatusMonitor();
                } catch {
                    // Non-blocking during onboarding finish.
                }
            },
            onPersist: async () => {
                d.settings.onboardingCompleted = true;
                if (d.settings.showTips !== false) {
                    d.settings.showTips = true;
                }
                if (
                    d.settings.showTips !== false &&
                    window.TipsPolicy &&
                    typeof window.TipsPolicy.startPromoPeriod === 'function' &&
                    window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false
                ) {
                    window.TipsPolicy.startPromoPeriod();
                }
                document.body.setAttribute('data-show-tips', d.shouldShowRotatingTipsNow() ? 'true' : 'false');
                await d.saveSettings();
                d.initializeButtonTipsRotation();
                d.onboardingStartedInSession = false;
                try {
                    localStorage.setItem('nextdash:layout-modern-nudge-v1', '1');
                } catch { /* layout chosen in onboarding */ }
                if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() !== false) {
                    d.schedulePostOnboardingPrompts({
                        delay: 600,
                        afterOnboarding: true,
                        resetAttempts: true,
                    });
                }
            }
        });
        d.onboardingStartedInSession = onboarding.shouldStart();
        if (d.onboardingStartedInSession) {
            const hintEl = document.getElementById('search-flow-hint');
            if (hintEl) {
                hintEl.hidden = true;
                hintEl.classList.remove('dismissing');
            }
            try {
                localStorage.removeItem('nextdash:search-flow-hint-v1');
                localStorage.removeItem('nextdash:search-flow-hint-v2');
            } catch {}
        }
        onboarding.maybeStart();
    }


    initializeFeatureTour() {
        const d = this.dash;
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return;
        const params = new URLSearchParams(window.location.search);
        if (params.has('tour')) {
            params.delete('tour');
            const clean = params.toString();
            history.replaceState(null, '', clean ? `?${clean}` : window.location.pathname);
            this.startFeatureTour();
        }
    }


    initializeConfigBookmarksTour() {
        const d = this.dash;
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return;
        if (typeof window.ConfigBookmarksTour?.maybeStartDashboardPhase !== 'function') return;
        d._configBookmarksTour = window.ConfigBookmarksTour.maybeStartDashboardPhase(d);
    }


    startFeatureTour(onFinish) {
        const d = this.dash;
        if (window.MobileExperience?.shouldSkipHeavyUi?.()) return;
        if (typeof window.FeatureTour !== 'function') return;
        if (d.featureTour) d.featureTour.finish?.();
        d.featureTour = new window.FeatureTour({
            settings: d.settings,
            language: d.language,
            onApplySettings: (nextSettings) => {
                d.settings = nextSettings;
                d.setupDOM();
                d.initializeAutoDarkMode();
                d.renderPageNavigation();
                d.renderDashboard();
                d.updateSearchComponent();
            },
            onPersist: async () => {
                await d.saveSettings();
                if (typeof onFinish === 'function') onFinish();
            }
        });
        d.featureTour.start();
    }

}

window.DashboardPromos = DashboardPromos;
