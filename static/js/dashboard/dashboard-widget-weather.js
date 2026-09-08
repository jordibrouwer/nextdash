/**
 * The weather widget: current conditions beside a forecast.
 *
 * Reuses the location/source/unit already set for the header's own weather
 * line (WeatherSource, WeatherLocation, WeatherUnit) rather than asking for
 * a second location -- one place to point at where the reader lives.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function say(body, className, text) {
        body.replaceChildren();
        const line = document.createElement('p');
        line.className = className;
        line.textContent = text;
        body.appendChild(line);
    }

    function localeOf(dash) {
        return dash?.settings?.language || document.documentElement.getAttribute('data-lang') || 'en';
    }

    function dayLabel(dash, dateStr, index) {
        if (index === 0) return label(dash, 'dashboard.widgetWeatherToday', 'Today');
        try {
            const date = new Date(`${dateStr}T00:00:00`);
            return new Intl.DateTimeFormat(localeOf(dash), { weekday: 'short' }).format(date);
        } catch (error) {
            return dateStr;
        }
    }

    function hourLabel(dash, timeStr) {
        try {
            return new Intl.DateTimeFormat(localeOf(dash), { hour: 'numeric' }).format(new Date(timeStr));
        } catch (error) {
            return timeStr;
        }
    }

    function weatherIcon(dash, code) {
        const span = document.createElement('span');
        span.className = 'dashboard-widget-weather-icon';
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = dash?.dateWeather?.getWeatherIconMarkup?.(code) || '';
        return span;
    }

    function forecastRangeOf(widget) {
        const mode = widget?.config?.forecastRange;
        return ['3day', '5day', '24h'].includes(mode) ? mode : '3day';
    }

    async function render(body, widget, dash) {
        const settings = dash?.settings || {};
        if (!dash?.weatherService) {
            say(body, 'dashboard-widget-empty', label(dash, 'dashboard.widgetWeatherUnavailable', 'Weather unavailable'));
            return;
        }
        if (settings.weatherSource !== 'browser' && !String(settings.weatherLocation || '').trim()) {
            say(body, 'dashboard-widget-empty', dash.dateWeather?.getWeatherErrorMessage?.('manual_location_missing')
                || label(dash, 'dashboard.widgetWeatherSetLocation', 'Set a weather location in Config'));
            return;
        }

        say(body, 'dashboard-widget-waiting', label(dash, 'dashboard.widgetWeatherWaiting', 'Checking…'));

        let result = null;
        try {
            result = await dash.weatherService.fetchForecast(settings, forecastRangeOf(widget), { useCache: true });
        } catch (error) {
            result = null;
        }
        if (!result) {
            say(body, 'dashboard-widget-empty',
                dash.dateWeather?.getWeatherErrorMessage?.(dash.weatherService.lastFetchError)
                || label(dash, 'dashboard.widgetWeatherUnavailable', 'Weather unavailable'));
            return;
        }

        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);

        const grid = document.createElement('div');
        grid.className = 'dashboard-widget-weather';

        const current = document.createElement('div');
        current.className = 'dashboard-widget-weather-current';
        current.appendChild(weatherIcon(dash, result.current.weatherCode));
        const temp = document.createElement('span');
        temp.className = 'dashboard-widget-weather-temp';
        temp.textContent = `${Math.round(result.current.temperature)}°${result.current.unitSymbol}`;
        current.appendChild(temp);
        const condition = document.createElement('span');
        condition.className = 'dashboard-widget-weather-condition';
        condition.textContent = dash.dateWeather?.getWeatherConditionLabel?.(result.current.weatherCode) || '';
        current.appendChild(condition);
        if (result.locationName) {
            const location = document.createElement('span');
            location.className = 'dashboard-widget-weather-location';
            location.textContent = result.locationName;
            current.appendChild(location);
        }

        const forecast = document.createElement('div');
        forecast.className = 'dashboard-widget-weather-forecast';

        if (Array.isArray(result.days)) {
            result.days.forEach((day, index) => {
                const row = document.createElement('div');
                row.className = 'dashboard-widget-weather-row';
                const dayText = document.createElement('span');
                dayText.className = 'dashboard-widget-weather-row-label';
                dayText.textContent = dayLabel(dash, day.date, index);
                const range = document.createElement('span');
                range.className = 'dashboard-widget-weather-row-range';
                range.textContent = `${Math.round(day.tempMax)}° / ${Math.round(day.tempMin)}°`;
                row.append(dayText, weatherIcon(dash, day.weatherCode), range);
                forecast.appendChild(row);
            });
        } else if (Array.isArray(result.hours)) {
            result.hours.forEach((hour) => {
                const row = document.createElement('div');
                row.className = 'dashboard-widget-weather-row';
                const hourText = document.createElement('span');
                hourText.className = 'dashboard-widget-weather-row-label';
                hourText.textContent = hourLabel(dash, hour.time);
                const value = document.createElement('span');
                value.className = 'dashboard-widget-weather-row-range';
                value.textContent = `${Math.round(hour.temperature)}°`;
                row.append(hourText, weatherIcon(dash, hour.weatherCode), value);
                forecast.appendChild(row);
            });
        }

        grid.append(current, forecast);
        wrap.appendChild(grid);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.weather = render;
})();
