/**
 * Date/time line and weather widget.
 */
class DashboardDateWeather {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    /**
     * Stops the clock for good: the interval and any pending resume listener.
     *
     * Callers use this to turn the date line off entirely, so a listener left
     * behind would restart the clock for an element that is no longer shown.
     * The pause path uses _stopDateTimeInterval() instead, which keeps the
     * resume hook alive on purpose.
     */
    clearDateTimeRefreshTimer() {
        const d = this.dash;
        this._stopDateTimeInterval();
        if (d._dateTimeResumeHandler) {
            document.removeEventListener('visibilitychange', d._dateTimeResumeHandler);
            d._dateTimeResumeHandler = null;
        }
        d._dateTimeResumeBound = false;
    }


    _stopDateTimeInterval() {
        const d = this.dash;
        if (d.dateTimeRefreshTimer) {
            clearInterval(d.dateTimeRefreshTimer);
            d.dateTimeRefreshTimer = null;
        }
    }


    /**
     * Ticks the clock once a minute while the tab is visible.
     *
     * The timer is dropped when the tab is hidden rather than left running to
     * skip its own work — a background tab has no clock to keep. Returning to
     * the tab re-renders the line immediately (see the visibilitychange handler
     * in dashboard.js), so nothing is stale by the time it is on screen again.
     */
    scheduleDateTimeRefresh() {
        const d = this.dash;
        this.clearDateTimeRefreshTimer();
        if (document.hidden) {
            this.bindDateTimeVisibilityResume();
            return;
        }
        d.dateTimeRefreshTimer = setInterval(() => {
            if (document.hidden) {
                this._stopDateTimeInterval();
                this.bindDateTimeVisibilityResume();
                return;
            }
            this.renderDateWeatherLine();
        }, 60 * 1000);
    }


    /** Restart the clock the next time the tab becomes visible. */
    bindDateTimeVisibilityResume() {
        const d = this.dash;
        if (d._dateTimeResumeBound) return;
        d._dateTimeResumeBound = true;
        const onVisible = () => {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', onVisible);
            d._dateTimeResumeHandler = null;
            d._dateTimeResumeBound = false;
            this.scheduleDateTimeRefresh();
        };
        d._dateTimeResumeHandler = onVisible;
        document.addEventListener('visibilitychange', onVisible);
    }


    clearWeatherRefreshTimer() {
        const d = this.dash;
        if (d.weatherRefreshTimer) {
            clearInterval(d.weatherRefreshTimer);
            d.weatherRefreshTimer = null;
        }
    }


    scheduleWeatherRefresh() {
        const d = this.dash;
        this.clearWeatherRefreshTimer();
        if (!d.shouldRenderDateBlock() || !d.settings.showWeatherWithDate) {
            return;
        }
        const minutes = Number(d.settings.weatherRefreshMinutes || 30);
        const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
        d.weatherRefreshTimer = setInterval(() => {
            this.refreshWeather(true);
        }, intervalMs);
    }


    formatDateLine(date) {
        const d = this.dash;
        const safeDate = date instanceof Date ? date : new Date();
        const fmt = String(d.settings.dateFormat || 'short-slash');
        const locale = String(d.settings.language || document.documentElement.getAttribute('data-lang') || 'en');

        if (fmt === 'short-slash') {
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${day}/${month}/${year}`;
        }

        if (fmt === 'short-dash') {
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${day}-${month}-${year}`;
        }

        if (fmt === 'mm-slash') {
            // MM/DD/YYYY
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${month}/${day}/${year}`;
        }

        if (fmt === 'iso') {
            // YYYY-MM-DD
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${year}-${month}-${day}`;
        }

        if (fmt === 'weekday-only') {
            try {
                return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(safeDate);
            } catch (e) {
                return safeDate.toLocaleDateString(locale, { weekday: 'long' });
            }
        }

        // long-weekday or any other value: use localized long format
        try {
            return new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(safeDate);
        } catch (e) {
            const day = String(safeDate.getDate()).padStart(2, '0');
            const month = String(safeDate.getMonth() + 1).padStart(2, '0');
            const year = safeDate.getFullYear();
            return `${day}-${month}-${year}`;
        }
    }


    formatTimeLine(date) {
        return window.NextDashClock.formatTime(date, this.dash.settings);
    }


    renderDateWeatherLine() {
        const d = this.dash;
        const dateElement = document.getElementById('date-element');
        if (!dateElement) return;
        const now = new Date();
        const datePart = d.settings.showDate ? this.formatDateLine(now) : '';
        const timePart = d.settings.showTime ? this.formatTimeLine(now) : '';
        const weatherPart = this.formatWeatherText(d.weatherData);

        // Localized date/time line: prefer translation keys when available
        const t = (key, fallback) => {
            const val = d.language?.t ? d.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };
        const tplCombined = t('dashboard.dateTimeLine', "It's {time} @ {date}");
        const tplTimeOnly = t('dashboard.dateTimeOnly', "It's {time}");

        let dateTimeText = '';
        if (timePart && datePart) {
            dateTimeText = tplCombined.replace('{time}', timePart).replace('{date}', datePart);
        } else if (timePart) {
            dateTimeText = tplTimeOnly.replace('{time}', timePart);
        } else if (datePart) {
            const raw = t('dashboard.dateOnly', null);
            dateTimeText = raw ? raw.replace('{date}', datePart) : datePart;
        }

        dateElement.textContent = '';
        if (dateTimeText) {
            const dateTimeLine = document.createElement('div');
            dateTimeLine.className = 'date-time-line';
            dateTimeLine.textContent = dateTimeText;
            dateTimeLine.setAttribute('role', 'button');
            dateTimeLine.setAttribute('tabindex', '0');
            dateTimeLine.setAttribute('aria-haspopup', 'dialog');
            dateTimeLine.addEventListener('click', () => this.showDatePopover());
            dateTimeLine.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showDatePopover(); } });
            dateElement.appendChild(dateTimeLine);
        }
        if (weatherPart) {
            const weatherLine = document.createElement('div');
            weatherLine.className = 'date-weather-line';
            const iconSpan = document.createElement('span');
            iconSpan.className = 'weather-icon';
            iconSpan.setAttribute('aria-hidden', 'true');
            iconSpan.innerHTML = this.getWeatherIconMarkup(d.weatherData?.weatherCode);
            const textSpan = document.createElement('span');
            textSpan.className = 'weather-text';
            textSpan.textContent = weatherPart;
            weatherLine.append(iconSpan, textSpan);
            dateElement.appendChild(weatherLine);
        } else if (d.settings.showWeatherWithDate && d.weatherLastError) {
            const errorText = this.getWeatherErrorMessage(d.weatherLastError);
            if (errorText) {
                const weatherLine = document.createElement('div');
                weatherLine.className = 'date-weather-line date-weather-line--error';
                weatherLine.textContent = errorText;
                weatherLine.setAttribute('role', 'status');
                dateElement.appendChild(weatherLine);
            }
        }

        // Compact mobile badge — only populated when the full .date block is hidden
        const badge = document.getElementById('date-badge-mobile');
        if (badge) {
            const parts = [];
            if (timePart) parts.push(timePart);
            if (datePart && d.settings.showDate) {
                const locale = String(d.settings.language || document.documentElement.getAttribute('data-lang') || 'en');
                try {
                    parts.push(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(now));
                } catch (_) {
                    parts.push(datePart);
                }
            }
            const compact = parts.join(' · ');
            badge.textContent = compact;
            badge.setAttribute('aria-label', dateTimeText || compact);
            if (!badge._dateBadgeListenerAttached) {
                badge._dateBadgeListenerAttached = true;
                badge.addEventListener('click', () => this.showDatePopover());
                badge.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.showDatePopover(); } });
            }
        }
    }


    showDatePopover() {
        const d = this.dash;
        const existing = document.getElementById('date-popover');
        if (existing) { existing.remove(); return; }

        const dateEl = document.getElementById('date-element');
        if (!dateEl) return;
        const rect = dateEl.getBoundingClientRect();
        const now = new Date();

        const isoWeek = (d) => {
            const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
            const jan1 = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
            return Math.ceil((((tmp - jan1) / 86400000) + 1) / 7);
        };

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        weekStart.setHours(0, 0, 0, 0);
        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            return d;
        });

        const locale = d.settings?.language || navigator.language || 'en';
        const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
        const dayLabels = days.map(d => dayFmt.format(d).slice(0, 2));

        const t = (key, fallback) => {
            const val = d.language?.t ? d.language.t(key) : null;
            return (val && val !== key) ? val : fallback;
        };

        const pop = document.createElement('div');
        pop.id = 'date-popover';
        pop.className = 'date-popover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', t('dashboard.weekOverviewLabel', 'Week overview'));
        pop.style.cssText = `position:fixed;top:${rect.bottom + 8}px;left:${rect.left}px;`;

        const weekLabel = document.createElement('div');
        weekLabel.className = 'date-popover-week-label';
        weekLabel.textContent = `${t('dashboard.weekLabel', 'Week')} ${isoWeek(now)}  ·  ${now.getFullYear()}`;
        pop.appendChild(weekLabel);

        const grid = document.createElement('div');
        grid.className = 'date-popover-grid';
        dayLabels.forEach(lbl => {
            const el = document.createElement('span');
            el.className = 'date-popover-col-label';
            el.textContent = lbl;
            grid.appendChild(el);
        });
        days.forEach(d => {
            const el = document.createElement('span');
            el.className = 'date-popover-day';
            if (d.toDateString() === now.toDateString()) el.classList.add('is-today');
            if (d.getDay() === 0 || d.getDay() === 6) el.classList.add('is-weekend');
            el.textContent = d.getDate();
            grid.appendChild(el);
        });
        pop.appendChild(grid);

        const calendarUrl = d.settings?.calendarUrl?.trim();
        if (calendarUrl) {
            const footer = document.createElement('div');
            footer.className = 'date-popover-footer';
            const calLink = document.createElement('a');
            calLink.className = 'date-popover-cal-link';
            calLink.href = calendarUrl;
            calLink.target = '_blank';
            calLink.rel = 'noopener noreferrer';
            calLink.textContent = t('dashboard.openCalendar', 'Open calendar →');
            footer.appendChild(calLink);
            pop.appendChild(footer);
        }

        document.body.appendChild(pop);

        const close = () => {
            pop.remove();
            document.removeEventListener('click', outside);
            document.removeEventListener('keydown', onKey);
            dateEl.focus?.({ preventScroll: true });
        };
        const outside = (e) => { if (!pop.contains(e.target) && !dateEl.contains(e.target)) close(); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        setTimeout(() => {
            document.addEventListener('click', outside);
            document.addEventListener('keydown', onKey);
        }, 0);
    }


    formatWeatherText(weatherData) {
        const d = this.dash;
        if (!weatherData || !d.weatherService) return '';
        const weatherLabelKey = d.weatherService?.getWeatherLabelKey(weatherData.weatherCode) || '';
        const isUnknownCondition = weatherLabelKey === 'dashboard.weatherCode.unknown';
        const conditionText = isUnknownCondition ? '' : this.getWeatherConditionLabel(weatherData.weatherCode);
        const temperature = Number(weatherData.temperature);
        const roundedTemperature = Number.isFinite(temperature) ? Math.round(temperature) : null;
        if (roundedTemperature === null) return '';
        const locationName = weatherData.locationName || (d.language?.t ? d.language.t('dashboard.weatherCurrentLocation') : 'Current location');
        const unitSymbol = weatherData.unitSymbol || 'C';
        if (!conditionText) {
            return `${locationName}, ${roundedTemperature}°${unitSymbol}`;
        }
        return `${locationName}, ${conditionText}, ${roundedTemperature}°${unitSymbol}`;
    }


    getWeatherIconMarkup(weatherCode) {
        const d = this.dash;
        const iconByType = {
            clear: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M4.9 4.9l2.1 2.1"></path><path d="M17 17l2.1 2.1"></path><path d="M2 12h3"></path><path d="M19 12h3"></path><path d="M4.9 19.1L7 17"></path><path d="M17 7l2.1-2.1"></path>',
            cloudy: '<path d="M6 17h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 17z"></path>',
            fog: '<path d="M4 10h16"></path><path d="M3 14h18"></path><path d="M5 18h14"></path>',
            drizzle: '<path d="M6 14h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 14z"></path><path d="M9 17l-1 2"></path><path d="M13 17l-1 2"></path><path d="M17 17l-1 2"></path>',
            rain: '<path d="M6 13h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 13z"></path><path d="M8 16l-1 3"></path><path d="M12 16l-1 3"></path><path d="M16 16l-1 3"></path>',
            snow: '<path d="M6 13h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 13z"></path><path d="M9 16v4"></path><path d="M7.5 17.5h3"></path><path d="M13 16v4"></path><path d="M11.5 17.5h3"></path><path d="M17 16v4"></path><path d="M15.5 17.5h3"></path>',
            thunderstorm: '<path d="M6 13h11a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 6 13z"></path><path d="M13 14l-3 5h2l-1 3 4-6h-2z"></path>',
            unknown: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2.2-2.5 4"></path><circle cx="12" cy="17.5" r="0.8"></circle>'
        };
        const weatherType = d.weatherService?.getWeatherType(weatherCode) || 'unknown';
        const iconPath = iconByType[weatherType] || iconByType.unknown;
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="weather-icon-svg">${iconPath}</svg>`;
    }


    getWeatherErrorMessage(errorCode) {
        const d = this.dash;
        const code = String(errorCode || '').trim();
        const keyByCode = {
            geolocation_denied: 'dashboard.weatherErrorGeolocationDenied',
            geolocation_timeout: 'dashboard.weatherErrorGeolocationTimeout',
            geolocation_unavailable: 'dashboard.weatherErrorGeolocationUnavailable',
            geolocation_failed: 'dashboard.weatherErrorGeolocationFailed',
            manual_location_missing: 'dashboard.weatherErrorManualLocationMissing',
            weather_fetch_failed: 'dashboard.weatherErrorFetchFailed',
        };
        const fallbackByCode = {
            geolocation_denied: 'Location access denied — set a manual location in Config',
            geolocation_timeout: 'Location request timed out',
            geolocation_unavailable: 'Location unavailable',
            geolocation_failed: 'Could not get location',
            manual_location_missing: 'Set a weather location in Config',
            weather_fetch_failed: 'Could not fetch weather',
        };
        const key = keyByCode[code];
        if (key) {
            const translated = d.language?.t ? d.language.t(key) : '';
            if (translated && translated !== key) {
                return translated;
            }
            return fallbackByCode[code] || '';
        }
        if (code.startsWith('geolocation_')) {
            return fallbackByCode.geolocation_failed;
        }
        const generic = d.language?.t ? d.language.t('dashboard.weatherUnavailable') : '';
        if (generic && generic !== 'dashboard.weatherUnavailable') {
            return generic;
        }
        return 'Weather unavailable';
    }


    getWeatherConditionLabel(weatherCode) {
        const d = this.dash;
        const key = d.weatherService?.getWeatherLabelKey(weatherCode) || 'dashboard.weatherCode.unknown';
        const fallbackKey = 'dashboard.weatherCode.unknown';
        const dashboardTranslations = d.language?.translations?.dashboard || {};

        // Existing locale files store weather keys as literal dotted keys:
        // "weatherCode.clear": "Clear"
        const dottedKey = key.replace('dashboard.', '');
        const dottedFallbackKey = fallbackKey.replace('dashboard.', '');
        if (typeof dashboardTranslations[dottedKey] === 'string') {
            return dashboardTranslations[dottedKey];
        }
        if (typeof dashboardTranslations[dottedFallbackKey] === 'string') {
            return dashboardTranslations[dottedFallbackKey];
        }

        // Future-proof fallback if locales become nested objects later.
        const translated = d.language?.t ? d.language.t(key) : '';
        if (translated && translated !== key) {
            return translated;
        }
        const fallback = d.language?.t ? d.language.t(fallbackKey) : '';
        if (fallback && fallback !== fallbackKey) {
            return fallback;
        }
        return 'Unknown';
    }


    async refreshWeather(forceRefresh = false) {
        const d = this.dash;
        if (!d.shouldRenderDateBlock() || !d.settings.showWeatherWithDate || !d.weatherService) {
            d.weatherData = null;
            this.renderDateWeatherLine();
            return;
        }

        if (d.settings.weatherSource === 'manual' && !String(d.settings.weatherLocation || '').trim()) {
            d.weatherData = null;
            this.renderDateWeatherLine();
            return;
        }

        try {
            d.weatherData = await d.weatherService.fetchWeather(d.settings, {
                useCache: !forceRefresh
            });
            d.weatherLastError = d.weatherService.lastFetchError || null;
        } catch (error) {
            d.weatherData = null;
            d.weatherLastError = 'weather_fetch_failed';
        }
        this.renderDateWeatherLine();
    }
}

window.DashboardDateWeather = DashboardDateWeather;
