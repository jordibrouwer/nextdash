/**
 * Theme, layout chrome, visibility toggles.
 */
class DashboardVisual {
    /**
     * Kept in step with the same markup in templates/dashboard.html — the server
     * renders the link, this is only the fallback for when it is absent.
     */
    static CONFIG_ICON_SVG = '<svg class="config-link-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        + '<circle cx="12" cy="12" r="3"/>'
        + '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
        + '</svg>';

    constructor(dashboard) {
        this.dash = dashboard;
        this._themeIconStylingListenerAttached = false;
        this._healthBadgePollTimer = null;
    }

    setupThemeIconStylingListener() {
        if (this._themeIconStylingListenerAttached || !window.ThemeLoader?.onThemeChange) {
            return;
        }
        this._themeIconStylingListenerAttached = true;
        window.ThemeLoader.onThemeChange(() => {
            window.ThemeIconStyling?.applyThemeIconStylingToDocument?.(this.dash.settings);
            const d = this.dash;
            if (d.activeView === 'config' && d.config?.section === 'appearance') {
                d.config.render?.();
            }
        });
    }

    applyVisualSettings() {
        const d = this.dash;
        if (window.VisualSettings) {
            window.VisualSettings.applyBackgroundOpacity(d.settings.backgroundOpacity);
            window.VisualSettings.applyFontWeight(d.settings.fontWeight);
            window.VisualSettings.applyAnimations(d.settings.animationsEnabled !== false);
        } else {
            const opacity = Number(d.settings.backgroundOpacity ?? 1);
            const clampedOpacity = window.VisualSettings?.clampBackgroundOpacity
                ? window.VisualSettings.clampBackgroundOpacity(opacity)
                : (Number.isFinite(opacity) ? Math.min(1, Math.max(0.65, opacity)) : 1);
            document.documentElement.style.setProperty('--dashboard-bg-opacity', String(clampedOpacity));

            const weight = d.settings.fontWeight || 'normal';
            document.body.style.setProperty('--dashboard-font-weight', weight);
            document.body.style.fontWeight = weight;
        }

        const iconSize = d.settings.launcherIconSize || 'normal';
        document.body.setAttribute('data-launcher-icon-size', iconSize);

        this.applyBackground();
    }


    applyBackground() {
        const d = this.dash;
        if (window.VisualSettings?.applyBackground) {
            window.VisualSettings.applyBackground(d.settings);
            return;
        }

        const type = d.settings.backgroundType || 'none';
        const body = document.body;
        body.classList.remove('has-custom-background', 'bg-gradient', 'bg-image');
        document.documentElement.style.removeProperty('--custom-background-image');

        const showDots = d.settings.showBackgroundDots !== false;

        if (type === 'none') {
            body.classList.toggle('no-background-dots', !showDots);
            window.ThemeLoader?.syncBackgroundDots?.(showDots);
            return;
        }

        const forceNoDots = (type === 'image');
        body.classList.toggle('no-background-dots', forceNoDots || !showDots);

        let presetName = '';
        if (type === 'auto') {
            const themeKey = window.VisualSettings?.resolveTheme?.(d.settings)
                || d.settings.theme
                || '';
            presetName = window.VisualSettings?.THEME_BACKGROUND_MAP?.[themeKey] || '';
        } else if (type === 'gradient') {
            presetName = d.settings.backgroundGradient || '';
        }

        let customBackground = '';
        if (presetName) {
            customBackground = window.VisualSettings?.BACKGROUND_PRESETS?.[presetName] || '';
        } else if (type === 'image') {
            customBackground = window.BookmarkUrlUtils?.safeCssImageUrl?.(d.settings.backgroundImageUrl) || '';
        }

        if (!customBackground) {
            window.ThemeLoader?.syncBackgroundDots?.(showDots);
            return;
        }

        document.documentElement.style.setProperty('--custom-background-image', customBackground);
        body.classList.add('has-custom-background');
        body.classList.add(presetName ? 'bg-gradient' : 'bg-image');
        window.ThemeLoader?.syncBackgroundDots?.(!forceNoDots && showDots);
    }


    initializeAutoDarkMode() {
        const d = this.dash;
        document.documentElement.setAttribute(
            'data-auto-dark-mode',
            d.settings?.autoDarkMode ? 'true' : 'false'
        );
        document.documentElement.setAttribute(
            'data-random-theme-mode',
            window.ThemeUtils?.normalizeRandomThemeMode?.(d.settings)
                || d.settings?.randomThemeMode
                || 'off'
        );

        if (window.VisualSettings?.applyAutoDarkMode) {
            window.VisualSettings.applyAutoDarkMode(d.settings, () => {
                this.applyBackground();
            });
            return;
        }

        const displayTheme = window.ThemeLoader?.resolveDisplayTheme
            ? window.ThemeLoader.resolveDisplayTheme(
                window.VisualSettings?.effectiveBaseTheme?.(d.settings)
                    || window.ThemeLoader.getEffectiveBaseTheme?.(d.settings, d.settings.theme || 'dark')
                    || d.settings.theme || 'dark',
                d.settings.autoDarkMode === true
            )
            : (d.settings.theme || 'dark');
        if (window.ThemeLoader?.applyTheme) {
            window.ThemeLoader.applyTheme(
                displayTheme,
                d.settings.showBackgroundDots !== false,
                d.settings.fontSize || 'm'
            );
        }
        this.applyBackground();
    }


    rotateRandomThemeIfViewMode() {
        const d = this.dash;
        const mode = window.ThemeUtils?.normalizeRandomThemeMode?.(d.settings)
            ?? d.settings?.randomThemeMode
            ?? 'off';
        if (mode !== 'view') {
            return;
        }
        window.ThemeLoader?.rotateSessionRandomTheme?.(d.settings);
        this.initializeAutoDarkMode();
        // All built-in/custom themes already live in /api/theme.css; switching
        // data-theme is enough. Reloading the stylesheet removes variables for a
        // frame and causes a white flash, especially in dark mode.
    }


    onActiveViewChanged(previousView, nextView) {
        if (!previousView || previousView === nextView) {
            return;
        }
        this.rotateRandomThemeIfViewMode();
    }


    onDashboardPageChanged(previousPageId, nextPageId) {
        const prev = Number(previousPageId);
        const next = Number(nextPageId);
        if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === next) {
            return;
        }
        this.rotateRandomThemeIfViewMode();
    }


    getPairedThemeVariant(themeId, wantsDark) {
        return window.ThemeUtils?.getPairedThemeVariant?.(themeId, wantsDark) ?? String(themeId || 'dark');
    }


    applyFontSize() {
        const d = this.dash;
        // Remove existing font size classes
        document.body.classList.remove('font-size-xs', 'font-size-s', 'font-size-sm', 'font-size-m', 'font-size-lg', 'font-size-l', 'font-size-xl');
        document.body.classList.remove('font-size-small', 'font-size-medium', 'font-size-large'); // Remove old classes
        
        // Migrate old values to new values
        let fontSize = d.settings.fontSize || 'm';
        if (fontSize === 'small') fontSize = 'sm';
        if (fontSize === 'medium') fontSize = 'm';
        if (fontSize === 'large') fontSize = 'l';
        
        // Update settings if migration occurred
        if (d.settings.fontSize !== fontSize) {
            d.settings.fontSize = fontSize;
            d.saveSettings();
        }
        
        // Add current font size class
        document.body.classList.add(`font-size-${fontSize}`);
        window.DashboardCategoryTitleFit?.invalidateMinCategoryFontCache?.();
        window.DashboardCategoryTitleFit?.scheduleFitAllCategoryTitles?.();
    }


    applyBackgroundDots() {
        const d = this.dash;
        // Toggle background dots class
        if (d.settings.showBackgroundDots !== false) {
            document.body.classList.remove('no-background-dots');
        } else {
            document.body.classList.add('no-background-dots');
        }
    }


    applyAnimations() {
        const d = this.dash;
        if (window.VisualSettings?.applyAnimations) {
            window.VisualSettings.applyAnimations(d.settings.animationsEnabled !== false);
            return;
        }
        if (d.settings.animationsEnabled !== false) {
            document.body.classList.remove('no-animations');
        } else {
            document.body.classList.add('no-animations');
        }
    }


    updateTitleVisibility() {
        const d = this.dash;
        // Update the data attribute for CSS visibility control
        document.body.setAttribute('data-show-title', d.settings.showTitle);
        
        // Update the title text if showing
        const titleElement = document.querySelector('.title');
        if (titleElement && d.settings.showTitle) {
            const currentPage = d.pages.find(p => p.id === d.currentPageId);
            d.updatePageTitle(currentPage ? currentPage.name : '');
        }
    }


    /** inbox · health · config cluster in the header row. */
    headerDestinationsHost() {
        return document.querySelector('.header-destinations')
            || document.querySelector('.header-actions');
    }


    updateConfigButtonVisibility() {
        const d = this.dash;
        const show = d.settings.showConfigButton !== false;
        let configLink = document.querySelector('.config-link');

        // Hidden via body[data-show-config-button] from setupDOM — do not remove
        // the node or SSR/i18n markup is lost and recreation lands outside
        // .header-destinations.
        if (!show) {
            return;
        }

        if (!configLink) {
            configLink = document.createElement('div');
            configLink.className = 'config-link config-link--icon';
            const configLabel = d.language.t('dashboard.config');
            const raw = configLabel !== 'dashboard.config' ? configLabel : 'config';
            // Escaped even though it comes from the locale files: an apostrophe or
            // quote in a translation would otherwise break out of the attribute.
            const label = d.escapeHtml ? d.escapeHtml(raw) : raw;
            configLink.innerHTML = `<a href="/#config" class="config-link-anchor" aria-label="${label}" title="${label}">${DashboardVisual.CONFIG_ICON_SVG}</a>`;

            this.headerDestinationsHost()?.appendChild(configLink);
        }
        this.syncConfigLinkActiveState();
    }


    /**
     * Mark the header config icon as the current view, mirroring the health icon.
     * Config is reached from a header link rather than a page tab, so
     * setActivePageNavButton never reaches it.
     */
    syncConfigLinkActiveState() {
        const d = this.dash;
        const anchor = document.querySelector('.config-link a.config-link-anchor');
        if (!anchor) {
            return;
        }
        const active = d.activeView === 'config';
        anchor.classList.toggle('active', active);
        // aria-current, not aria-selected: this is a link, not a tab in a tablist.
        if (active) {
            anchor.setAttribute('aria-current', 'page');
        } else {
            anchor.removeAttribute('aria-current');
        }
    }


    /**
     * The header health icon opens the health view in place.
     */
    bindHealthLinkToView(healthLink) {
        const d = this.dash;
        const anchor = healthLink?.querySelector?.('a.health-link-anchor');
        if (!anchor || anchor.dataset.healthViewBound === '1') {
            return;
        }
        anchor.dataset.healthViewBound = '1';
        anchor.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
            }
            if (!d.health?.isEnabled?.()) {
                return;
            }
            e.preventDefault();
            void d.health.openHealthView();
        });
    }


    /**
     * Mark the header health icon as the current view, the way an active page tab is
     * marked. It is an <a> outside #page-navigation, so setActivePageNavButton never
     * reaches it — without this the health view would be the only view with no
     * indication of where you are.
     */
    syncHealthLinkActiveState() {
        const d = this.dash;
        const anchor = document.querySelector('.health-link a.health-link-anchor');
        if (!anchor) {
            return;
        }
        const active = d.activeView === 'health';
        anchor.classList.toggle('active', active);
        // aria-current, not aria-selected: this is a link, not a tab in a tablist.
        if (active) {
            anchor.setAttribute('aria-current', 'page');
        } else {
            anchor.removeAttribute('aria-current');
        }
    }


    updateHealthDashboardVisibility() {
        const d = this.dash;
        let healthLink = document.querySelector('.health-link');

        if (d.settings.showHealthDashboard === true) {
            if (!healthLink) {
                healthLink = document.createElement('div');
                healthLink.className = 'health-link health-link--icon';
                const healthLabel = d.language.t('dashboard.health');
                const raw = healthLabel !== 'dashboard.health' ? healthLabel : 'health';
                // Escaped for the same reason as the config label above.
                const label = d.escapeHtml ? d.escapeHtml(raw) : raw;
                healthLink.innerHTML = `<a href="/#health" class="health-link-anchor" aria-label="${label}" title="${label}"><svg class="health-link-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg></a>`;

                const host = this.headerDestinationsHost();
                if (host) {
                    const configLink = host.querySelector('.config-link');
                    if (configLink) {
                        host.insertBefore(healthLink, configLink);
                    } else {
                        host.appendChild(healthLink);
                    }
                }
            }
            this.bindHealthLinkToView(healthLink);
            this.updateHealthBadge();
            this.syncHealthBadgePolling();
        } else if (healthLink) {
            healthLink.remove();
            this.stopHealthBadgePolling();
        }
    }

    /**
     * Keep the header badge fresh while bookmarks or monitors change elsewhere.
     * The health view has its own live refresh — polling is paused there.
     */
    syncHealthBadgePolling() {
        this.stopHealthBadgePolling();
        const d = this.dash;
        if (d.settings.showHealthDashboard !== true) {
            return;
        }
        this._healthBadgePollTimer = setInterval(() => {
            if (document.visibilityState !== 'visible') {
                return;
            }
            if (d.activeView === 'health') {
                return;
            }
            void this.updateHealthBadge();
        }, 60000);
    }

    stopHealthBadgePolling() {
        if (this._healthBadgePollTimer) {
            clearInterval(this._healthBadgePollTimer);
            this._healthBadgePollTimer = null;
        }
    }


    async updateHealthBadge() {
        const d = this.dash;
        const anchor = document.querySelector('.health-link a');
        const utils = window.HealthBadgeUtils;
        if (!anchor || !utils) return;

        try {
            const summary = await utils.fetchBookmarkHealthSummary();
            if (!summary) return;
            // keepHref: the icon opens the view; its href is only the middle-click path.
            utils.applyHealthBadgeToAnchor(anchor, summary, d.language, {
                keepHref: true,
                onApplied: (counts) => this.maybePulseHealthAlert(counts?.monitorDown || 0),
            });
            d.updateMiniStatusLine();
        } catch (e) {
            // Silently skip — badge is non-critical
        }
    }

    /**
     * Pulse the health link once when the number of down monitors rises.
     *
     * Two guards keep it from becoming noise. It only fires on a *rise*, so a
     * reload that finds an existing outage — or a recovery — stays quiet; the
     * static badge already shows the standing state. And a cooldown suppresses a
     * flapping monitor: one that drops and recovers every few minutes would
     * otherwise pulse the header on every tick. The first observation seeds the
     * baseline without animating, so opening the dashboard onto a live outage is
     * not treated as a fresh one.
     */
    maybePulseHealthAlert(downCount) {
        const previous = this._lastMonitorDownCount;
        this._lastMonitorDownCount = downCount;

        // First sight: record the level, do not animate. Distinguishes "already
        // down when I arrived" from "went down while I was watching".
        if (previous === undefined) return;
        if (downCount <= previous) return;

        const now = Date.now();
        const COOLDOWN_MS = 10 * 60 * 1000;
        if (this._lastHealthAlertAt && now - this._lastHealthAlertAt < COOLDOWN_MS) {
            return;
        }
        this._lastHealthAlertAt = now;

        const link = document.querySelector('.health-link');
        if (!link) return;
        link.classList.remove('is-health-alert');
        // Reflow so a repeat alert replays the animation rather than being ignored
        // as a no-op class toggle.
        void link.offsetWidth;
        link.classList.add('is-health-alert');
        const anchor = link.querySelector('.health-link-anchor');
        const done = () => link.classList.remove('is-health-alert');
        if (anchor) {
            anchor.addEventListener('animationend', done, { once: true });
        }
        // Fallback: reduced-motion and no-animations kill the animation, so
        // animationend never fires — clear the class on a timer regardless.
        setTimeout(done, 2000);
    }


    updatePageTabsVisibility() {
        const d = this.dash;
        const pageNavigation = document.getElementById('page-navigation');
        if (pageNavigation) {
            // Clear the property rather than forcing 'block': .page-navigation is a
            // flex row, and an inline display:block dropped that, leaving the tabs
            // and the header icons on three different baselines.
            pageNavigation.style.display = d.settings.showPageTabs ? '' : 'none';
        }
        const inboxHost = document.getElementById('page-nav-inbox-host');
        if (inboxHost) {
            inboxHost.style.display = d.settings.showPageTabs ? '' : 'none';
        }
    }


    updateDateVisibility() {
        const d = this.dash;
        let dateElement = document.getElementById('date-element');

        if (this.shouldRenderDateBlock()) {
            // Show date - create if it doesn't exist
            if (!dateElement) {
                dateElement = document.createElement('div');
                dateElement.id = 'date-element';
                dateElement.className = 'date';
                
                // Insert at the beginning of header (use safe header container)
                const header = d.getHeaderContainer();
                if (header.firstChild) {
                    header.insertBefore(dateElement, header.firstChild);
                } else {
                    header.appendChild(dateElement);
                }
            }
            
            d.renderDateWeatherLine();
            d.scheduleDateTimeRefresh();
            d.scheduleWeatherRefresh();
            d.refreshWeather(false);
        } else {
            // Hide date - remove if it exists
            if (dateElement) {
                dateElement.remove();
            }
            d.clearDateTimeRefreshTimer();
            d.clearWeatherRefreshTimer();
            d.weatherData = null;
        }
    }


    shouldRenderDateBlock() {
        const d = this.dash;
        return d.settings.showDate || d.settings.showTime || d.settings.showWeatherWithDate;
    }

}

window.DashboardVisual = DashboardVisual;
