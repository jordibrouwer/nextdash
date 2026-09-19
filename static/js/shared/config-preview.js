/**
 * The live preview beside Config → Appearance.
 *
 * A drawing of the dashboard that follows the settings as they are changed,
 * so a choice is seen before the reader leaves config to look. It draws the
 * whole page small -- header, grid, a few rows, the action dock -- and marks
 * the part the open tab changes: the grid on Grid, the rows on Rows, the
 * header on Header and on Date & weather, the dock on Action bar. Look changes
 * everything, so nothing is dimmed there.
 *
 * Colours and type are not drawn from the settings at all: the preview sits
 * inside the page and inherits the theme's variables and font, so a theme or
 * font change reaches it with no code here.
 *
 * This file only draws. Saving, resets and the controls stay in
 * dashboard-config.js, which calls render() inside the tab page and repaint()
 * after a setting changed.
 */
(function (global) {
    'use strict';

    /** Which part of the drawing each Appearance tab is about. */
    const FOCUS = {
        general: 'all',
        layout: 'grid',
        display: 'rows',
        header: 'head',
        datetime: 'clock',
        buttonbar: 'actions',
    };

    const SAMPLE_ROWS = [
        { name: 'GitHub', key: 'gh', tags: ['code', 'work', 'daily'], status: 'up', ping: 42 },
        { name: 'Grafana', key: 'gr', tags: ['ops', 'home'], status: 'down', ping: 0 },
        { name: 'Calendar', key: 'ca', tags: ['daily'], status: 'up', ping: 88 },
    ];

    function clockText(s) {
        const time = s.timeFormat === '12h' ? '9:41 AM' : '09:41';
        const date = s.dateFormat === 'weekday-only' ? 'Thursday'
            : s.dateFormat === 'long-weekday' ? 'Thu 31 Dec'
                : s.dateFormat === 'iso' ? '2026-12-31'
                    : s.dateFormat === 'mm-slash' ? '12/31/2026'
                        : s.dateFormat === 'short-dash' ? '31-12-2026' : '31/12/2026';
        const parts = [];
        if (s.showTime !== false) parts.push(time);
        if (s.showDate !== false) parts.push(date);
        if (s.showWeatherWithDate) parts.push(s.weatherUnit === 'fahrenheit' ? '64°F' : '18°C');
        return parts.join(' · ');
    }

    function render(config, tab) {
        const s = config.dash?.settings || {};
        const esc = (v) => config.dash.escapeHtml(String(v));
        const focus = FOCUS[tab] || 'all';

        const cols = Math.min(6, Math.max(1, Number(s.columnsPerRow) || 4));
        const place = ['bottom', 'left', 'right', 'menu'].includes(s.actionBarPosition) ? s.actionBarPosition : 'header';
        const switcher = ['text', 'segmented', 'compact'].includes(s.pageSwitcherStyle) ? s.pageSwitcherStyle : 'classic';
        const density = s.densityMode || 'comfortable';
        const barState = s.actionBarEnabled === false ? 'off'
            : (Number(s.actionBarAutoHideSeconds) > 0 && ['bottom', 'left', 'right'].includes(place) ? 'sliding' : 'on');
        const clockPlace = ['beside-name', 'own-zone'].includes(s.headerClockPlacement) ? s.headerClockPlacement : 'classic';

        const title = s.enableCustomTitle && String(s.customTitle || '').trim()
            ? String(s.customTitle).trim()
            : 'main';
        const names = s.showPageNamesInTabs ? ['main', 'web', 'media'] : ['1', '2', '3'];
        const tabs = s.showPageTabs === false ? ''
            : switcher === 'compact'
                ? `<span class="config-pv-tab is-on">${esc(names[0])} ▾</span>`
                : names.map((n, i) => `<span class="config-pv-tab${i === 0 ? ' is-on' : ''}">${esc(n)}</span>`).join('');
        const clock = clockText(s);

        const cells = Array.from({ length: cols * 2 }, () => '<i></i>').join('');

        const maxTags = Math.min(5, Math.max(1, Number(s.rowTagsMax) || 2));
        const rows = SAMPLE_ROWS.map((row, i) => {
            const shownTags = row.tags.slice(0, maxTags);
            const more = row.tags.length - shownTags.length;
            const tags = s.showRowTags
                ? `<span class="config-pv-tags">${shownTags.map((t) => `<em>${esc(t)}</em>`).join('')}${more > 0 ? `<em>+${more}</em>` : ''}</span>`
                : '';
            const status = s.showStatus === false ? ''
                : `<span class="config-pv-status is-${row.status}"></span>`;
            const ping = s.showPing && row.ping ? `<span class="config-pv-ping">${row.ping}ms</span>` : '';
            const key = s.shortcutDisplay === 'always' || i === 0
                ? `<span class="config-pv-key">${esc(row.key)}</span>` : '';
            return `<div class="config-pv-row${i === 0 ? ' is-cursor' : ''}${s.colorizeStatus && row.status === 'down' ? ' is-down' : ''}">
                ${s.showIcons === false ? '' : '<span class="config-pv-icon"></span>'}
                <span class="config-pv-name">${esc(row.name)}</span>${tags}
                <span class="config-pv-end">${ping}${status}${key}</span>
            </div>`;
        }).join('');

        return `
            <div class="config-preview" aria-hidden="true"
                 data-preview-focus="${esc(focus)}"
                 data-preview-cols="${cols}" data-preview-actions="${esc(place)}" data-preview-bar="${barState}"
                 data-preview-switcher="${esc(switcher)}" data-preview-density="${esc(density)}"
                 data-preview-buttons="${s.headerButtonStyle === 'plated' ? 'plated' : 'plain'}"
                 data-preview-clock="${esc(clockPlace)}"
                 data-preview-highlight="${esc(s.rowHighlight || 'subtle')}">
                <div class="config-pv-head" data-pv-part="head">
                    <span class="config-pv-name-block">
                        ${s.showTitle === false ? '' : `<span class="config-pv-title">${esc(title)}</span>`}
                        ${clock ? `<span class="config-pv-clock" data-pv-part="clock">${esc(clock)}</span>` : ''}
                    </span>
                    <span class="config-pv-tabs">${tabs}</span>
                    <span class="config-pv-dest" data-pv-part="actions">${place === 'header' ? '<b></b><b></b>' : (place === 'menu' ? '<b></b>' : '')}<em></em><em></em></span>
                </div>
                <div class="config-pv-grid" data-pv-part="grid" style="--pv-cols:${cols}">${cells}</div>
                <div class="config-pv-rows" data-pv-part="rows">${rows}</div>
                <div class="config-pv-dock" data-pv-part="actions"></div>
            </div>`;
    }

    function repaint(config, tab) {
        document.querySelectorAll('[data-config-preview]').forEach((host) => {
            host.innerHTML = render(config, tab);
        });
    }

    global.ConfigPreview = { FOCUS, render, repaint };
}(typeof window !== 'undefined' ? window : globalThis));
