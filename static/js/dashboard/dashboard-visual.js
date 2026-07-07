/**
 * Theme, layout chrome, visibility toggles.
 */
class DashboardVisual {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    applyVisualSettings() {
        const d = this.dash;
        if (window.VisualSettings) {
            window.VisualSettings.applyBackgroundOpacity(d.settings.backgroundOpacity);
            window.VisualSettings.applyFontWeight(d.settings.fontWeight);
            window.VisualSettings.applyAnimations(d.settings.animationsEnabled !== false);
        } else {
            const opacity = Number(d.settings.backgroundOpacity ?? 1);
            const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
            document.documentElement.style.setProperty('--dashboard-bg-opacity', String(clampedOpacity));
            document.body.style.setProperty('opacity', String(Math.max(0.65, clampedOpacity)));

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

        if (window.VisualSettings?.applyAutoDarkMode) {
            window.VisualSettings.applyAutoDarkMode(d.settings, () => {
                this.applyBackground();
            });
            return;
        }

        const displayTheme = window.ThemeLoader?.resolveDisplayTheme
            ? window.ThemeLoader.resolveDisplayTheme(
                d.settings.theme || 'dark',
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


    getPairedThemeVariant(themeId, wantsDark) {
        const d = this.dash;
        const base = String(themeId || 'dark');
        const userCustomIds = window.UserCustomThemeIds;
        if (Array.isArray(userCustomIds) && userCustomIds.includes(base)) {
            return base;
        }
        if (window.VisualSettings?.getPairedThemeVariant) {
            return window.VisualSettings.getPairedThemeVariant(themeId, wantsDark);
        }
        if (base === 'dark' || base === 'light') {
            return wantsDark ? 'dark' : 'light';
        }
        const match = base.match(/^(.*)-(dark|light)$/);
        if (!match) {
            return base;
        }
        return `${match[1]}-${wantsDark ? 'dark' : 'light'}`;
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
            titleElement.textContent = currentPage ? currentPage.name : d.language.t('dashboard.defaultPageTitle');
        }
    }


    updateConfigButtonVisibility() {
        const d = this.dash;
        let configLink = document.querySelector('.config-link');

        // Config button is always visible
        if (!configLink) {
            configLink = document.createElement('div');
            configLink.className = 'config-link';
            const configLabel = d.language.t('dashboard.config');
            configLink.innerHTML = `<a href="/config">${configLabel !== 'dashboard.config' ? configLabel : 'config'}</a>`;

            const headerActions = document.querySelector('.header-actions');
            if (headerActions) {
                headerActions.appendChild(configLink);
            }
        }
    }


    updateHealthDashboardVisibility() {
        const d = this.dash;
        let healthLink = document.querySelector('.health-link');

        if (d.settings.showHealthDashboard === true) {
            if (!healthLink) {
                healthLink = document.createElement('div');
                healthLink.className = 'health-link';
                const healthLabel = d.language.t('dashboard.health');
                healthLink.innerHTML = `<a href="/health">${healthLabel !== 'dashboard.health' ? healthLabel : 'health'}</a>`;

                const headerActions = document.querySelector('.header-actions');
                if (headerActions) {
                    const configLink = headerActions.querySelector('.config-link');
                    if (configLink) {
                        headerActions.insertBefore(healthLink, configLink);
                    } else {
                        headerActions.appendChild(healthLink);
                    }
                }
            }
            this.updateHealthBadge();
        } else if (healthLink) {
            healthLink.remove();
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
            utils.applyHealthBadgeToAnchor(anchor, summary, d.language);
            d.updateMiniStatusLine();
        } catch (e) {
            // Silently skip — badge is non-critical
        }
    }


    updatePageTabsVisibility() {
        const d = this.dash;
        const pageNavigation = document.getElementById('page-navigation');
        if (pageNavigation) {
            pageNavigation.style.display = d.settings.showPageTabs ? 'block' : 'none';
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
