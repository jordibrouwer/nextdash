/**
 * Clock and weather, asked once in the corner.
 *
 * The first-run setup card used to ask for a city, a clock and a unit before
 * the reader had seen the dashboard those answers are about. It is gone, and
 * the questions came with it -- which left the weather line switched off with
 * nothing anywhere saying it could be on, and a 24-hour clock on installs that
 * do not read time that way.
 *
 * So it is asked here instead: one small card in the corner, at the moment the
 * dashboard is already on screen, with the three answers on the card itself.
 * "Save" writes them and leaves; the x, or "Not now", answers it for good --
 * the same settings sit in Config -> Appearance -> Date & weather.
 *
 * The card (markup, corner etiquette, retry loop) comes from NoticeCard; only
 * the fields and what they do are here.
 */
(function initClockWeatherNotice(global) {
    'use strict';

    const PROMO_ID = 'clock-weather-v1';
    // After the announcements that are one sentence long: this one asks for
    // typing, so it should not be the first thing a corner offers.
    const SHOW_DELAY_MS = 7000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    const escape = window.NextDashHtml.escapeHtml;

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /** No location to show weather from, whether or not weather is switched on. */
    function lacksLocation() {
        const s = dash()?.settings;
        if (!s) return false;
        if (s.weatherSource === 'browser') return false;
        return String(s.weatherLocation || '').trim() === '';
    }

    /** One row of choices: a label and two or three buttons that stay put. */
    function choiceRow(name, label, options, current) {
        const buttons = options.map(([value, text]) => `
            <button type="button" class="clock-weather-choice" data-choice="${escape(name)}"
                    data-value="${escape(value)}" aria-pressed="${value === current ? 'true' : 'false'}">
                ${escape(text)}
            </button>`).join('');
        return `
            <div class="clock-weather-row">
                <span class="clock-weather-label">${escape(label)}</span>
                <div class="clock-weather-choices">${buttons}</div>
            </div>`;
    }

    function fieldsMarkup() {
        const s = dash()?.settings || {};
        return `
            <div class="clock-weather-fields">
                <label class="clock-weather-row" for="clock-weather-place">
                    <span class="clock-weather-label">${escape(t('dashboard.clockWeatherPlace', 'Town or city'))}</span>
                    <input type="text" id="clock-weather-place" class="clock-weather-input"
                           autocomplete="address-level2" spellcheck="false"
                           placeholder="${escape(t('dashboard.clockWeatherPlacePlaceholder', 'Leiden'))}"
                           value="${escape(String(s.weatherLocation || ''))}">
                </label>
                ${choiceRow('timeFormat', t('dashboard.clockWeatherClock', 'Clock'), [
        ['24h', t('dashboard.clockWeather24h', '24-hour')],
        ['12h', t('dashboard.clockWeather12h', '12-hour')],
    ], s.timeFormat === '12h' ? '12h' : '24h')}
                ${choiceRow('weatherUnit', t('dashboard.clockWeatherUnit', 'Temperature'), [
        ['celsius', '°C'],
        ['fahrenheit', '°F'],
    ], s.weatherUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius')}
            </div>`;
    }

    /** The answers as they stand on the card right now. */
    function readCard(el) {
        const chosen = (name, fallback) => el
            .querySelector(`[data-choice="${name}"][aria-pressed="true"]`)?.dataset.value || fallback;
        return {
            weatherLocation: el.querySelector('#clock-weather-place')?.value.trim() || '',
            timeFormat: chosen('timeFormat', '24h'),
            weatherUnit: chosen('weatherUnit', 'celsius'),
        };
    }

    function wireCard(card) {
        const el = card.element;
        if (!el) return;
        el.querySelector('.notice-card-actions')?.insertAdjacentHTML('beforebegin', fieldsMarkup());
        el.querySelectorAll('.clock-weather-choice').forEach((btn) => {
            btn.addEventListener('click', () => {
                el.querySelectorAll(`[data-choice="${btn.dataset.choice}"]`)
                    .forEach((other) => other.setAttribute('aria-pressed', String(other === btn)));
            });
        });
    }

    async function save(card) {
        const d = dash();
        const el = card.element;
        if (!d || !el) return;
        const answers = readCard(el);
        Object.assign(d.settings, {
            timeFormat: answers.timeFormat,
            weatherUnit: answers.weatherUnit,
            weatherLocation: answers.weatherLocation,
            weatherSource: 'manual',
            // A place to look up is what the weather line was missing; giving
            // one is asking for it. Without one, only the clock changes.
            showWeatherWithDate: answers.weatherLocation !== ''
                ? true
                : d.settings.showWeatherWithDate === true,
        });
        markAnswered();
        try {
            await d.saveSettings?.();
        } catch {
            card.showError(t('dashboard.clockWeatherSaveFailed', 'Could not save. The same settings are in Config → Appearance → Date & weather.'));
            return;
        }
        d.renderDateWeatherLine?.();
        d.refreshWeather?.(true);
        card.close();
    }

    const card = global.NoticeCard.define({
        id: 'clock-weather-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.clockWeatherTitle', 'Clock and weather'),
        body: () => t('dashboard.clockWeatherBody',
            'Name a town and the header shows its weather beside the date. The clock and the unit are yours to pick too.'),
        dismissLabel: () => t('dashboard.clockWeatherDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => !hasAnswered() && lacksLocation(),
        onDismiss: markAnswered,
        onShown: wireCard,
        actionAttr: 'data-clock-weather-action',
        actions: [
            {
                name: 'save',
                label: () => t('dashboard.clockWeatherSave', 'Save'),
                primary: true,
                onClick: save,
            },
            {
                name: 'dismiss',
                label: () => t('dashboard.clockWeatherNotNow', 'Not now'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    global.ClockWeatherNotice = card;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }
}(typeof window !== 'undefined' ? window : globalThis));
