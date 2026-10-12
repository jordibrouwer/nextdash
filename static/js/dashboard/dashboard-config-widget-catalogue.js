/**
 * Config → Widgets: the Catalogue and Custom widget tabs.
 *
 * The Catalogue is every kind on one page, each with a small drawing of what
 * it shows, so a reader can look before adding anything -- the Add modal is
 * the quick way in, this is the place to browse. The Custom tab is the one
 * kind that is a capability rather than a report, explained with a picture of
 * where its figures come from.
 *
 * The drawings are made-up figures in a handful of shapes (rows, a bar, a big
 * number, a spark), not a render of the real widget: the dashboard's own
 * renderers fetch and tick, and a catalogue that called thirty services to
 * show what they look like would be a catalogue that is slow to open.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    /*
     * Example figures per kind. Plain strings on purpose: a drawing, hidden
     * from assistive tech, whose words are part of the picture. The Unraid
     * ones match the Unraid section's own preview, so the same tile does not
     * look two ways in two places.
     */
    const SAMPLES = {
        health: { rows: [['broken', '3', 'bad'], ['down now', '1', 'warn'], ['healthy', '412', 'good']] },
        uptime: { big: '99.2%', spark: [90, 95, 60, 100, 97, 100, 99] },
        certs: { rows: [['nas.lan', '12 days', 'warn'], ['git.lan', '71 days', 'good']] },
        trend: { big: '+12', spark: [30, 42, 38, 55, 61, 58, 70] },
        inbox: { big: '14', rows: [['oldest', '3 days']] },
        unsorted: { big: '27', rows: [['newest', 'today']] },
        feeds: { rows: [['Changelog', '2 new', 'good'], ['Blog', '—']] },
        sources: { rows: [['extension', '41'], ['bookmarklet', '7']] },
        neglected: { big: '38', rows: [['not opened in', '6 months']] },
        unchecked: { big: '19', rows: [['never checked', '19', 'warn']] },
        duplicates: { big: '5', rows: [['same address', '5']] },
        archive: { rows: [['saved whole', '128']], bars: [['disk', 0.4]] },
        trash: { big: '9', rows: [['emptied in', '21 days']] },
        backups: { rows: [['last', '2 h ago', 'good'], ['kept', '14']] },
        cpu: { pulse: ['load', '23%'], bars: [['', 0.23]] },
        memory: { rows: [['used', '11.2 / 32 GB']], bars: [['', 0.35]] },
        disks: { bars: [['/', 0.61], ['/mnt/data', 0.88, 'warn']] },
        docker: { rows: [['running', '12', 'good'], ['stopped', '1', 'warn']] },
        containers: { rows: [['updates', '3', 'warn'], ['healthy', '14', 'good']] },
        unraid: { rows: [['array', 'started', 'good'], ['alerts', '2 unread', 'warn']] },
        unraidArray: { bars: [['disk1', 0.74]] },
        unraidParity: { bars: [['check', 0.63]] },
        unraidShares: { rows: [['array', '44%'], ['cache', '13%']] },
        unraidVms: { pulse: ['home-assistant', 'on'] },
        unraidUps: { bars: [['battery', 1, 'good']] },
        unraidNotifications: { rows: [['parity check', 'done'], ['2 alerts', '', 'warn']] },
        weather: { big: '14°', rows: [['rain', '30%']] },
        calendar: { rows: [['09:30', 'Stand-up'], ['14:00', 'Dentist']] },
        rss: { rows: [['Release 2.4 is out', ''], ['A note on caching', '']] },
        notes: { rows: [['☑ renew domain', ''], ['☐ swap disk', '']] },
        jellyfin: { rows: [['Severance', 'S2E4'], ['Dune: Part Two', 'film']] },
        custom: { rows: [['queued', '7'], ['paused', '2']] },
    };

    Object.assign(global.DashboardConfig.prototype, {

    /** One kind's drawing, in the Unraid preview's vocabulary of rows and bars. */
    renderWidgetSample(type) {
        const esc = (v) => this.dash.escapeHtml(v);
        const sample = SAMPLES[type] || { rows: [[this.widgetTypeName(type), '']] };
        const tone = (name) => (name ? ` class="config-widget-kind-${name}"` : '');
        const parts = [];
        if (sample.big) parts.push(`<span class="config-widget-kind-big">${esc(sample.big)}</span>`);
        if (sample.pulse) {
            parts.push(`<span class="unraid-mini-row"><span><span class="unraid-mini-pulse"></span>${
                esc(sample.pulse[0])}</span><span class="config-widget-kind-good">${esc(sample.pulse[1])}</span></span>`);
        }
        (sample.rows || []).forEach(([name, value, t]) => {
            parts.push(`<span class="unraid-mini-row"><span>${esc(name)}</span><span${tone(t)}>${esc(value)}</span></span>`);
        });
        (sample.bars || []).forEach(([name, fill, t]) => {
            if (name) {
                parts.push(`<span class="unraid-mini-row"><span>${esc(name)}</span><span${tone(t)}>${
                    esc(`${Math.round(fill * 100)}%`)}</span></span>`);
            }
            parts.push(`<span class="unraid-mini-bar${t ? ` unraid-mini-bar--${t}` : ''}"><i style="--fill:${fill}"></i></span>`);
        });
        if (sample.spark) {
            const max = Math.max(...sample.spark);
            parts.push(`<span class="config-widget-kind-spark">${sample.spark.map((value, j) =>
                `<i style="--h:${Math.round((value / max) * 100)};--j:${j}"></i>`).join('')}</span>`);
        }
        return parts.join('');
    },

    /** How many of each kind the list holds, for the "on this page" badge. */
    widgetKindCounts() {
        const counts = {};
        (this._widgetBlocks || []).forEach((block) => {
            if (block?.isWidget) counts[block.type] = (counts[block.type] || 0) + 1;
        });
        return counts;
    },

    /** The page Add writes to, as the same select Your widgets uses. */
    renderWidgetKindPagePicker() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = Array.isArray(this.dash.pages) ? this.dash.pages : [];
        if (pages.length < 2) return '';
        const pageId = this._widgetPageId != null ? this._widgetPageId : (this.dash.currentPageId ?? pages[0]?.id);
        // From All pages, a prompt rather than a page quietly picked for them.
        const prompt = this.isAllPagesView()
            ? `<option value="" selected disabled>${esc(this.t('config.widgetKindsChoosePage', 'Choose a page…'))}</option>`
            : '';
        const options = prompt + pages.map((p) =>
            `<option value="${esc(p.id)}" ${Number(p.id) === Number(pageId) ? 'selected' : ''}>${esc(p.name || p.id)}</option>`
        ).join('');
        return `
            <label class="config-widget-kinds-page">
                <span>${esc(this.t('config.widgetKindsAddsTo', 'Adds to'))}</span>
                <select class="config-select config-select--small" data-widget-page>${options}</select>
            </label>`;
    },

    /*
     * The Catalogue tab: every kind, drawn, grouped under the question it
     * answers, with chips to narrow it to one group. Add puts the kind on the
     * page named in the header and opens it on Your widgets.
     */
    renderWidgetCatalogueTab() {
        const esc = (v) => this.dash.escapeHtml(v);
        // All pages has no one page to add to, so Add waits for one to be
        // chosen in the header rather than guessing.
        const canAdd = !this.isAllPagesView();
        const counts = this.widgetKindCounts();
        const filter = this.widgetKindFilter || 'all';
        const groups = DashboardConfig.WIDGET_TYPE_GROUPS;
        const total = groups.reduce((n, [, types]) => n + types.length, 0) + 1;

        const chip = (value, label) => `<button type="button" class="config-widget-kind-chip${
            value === filter ? ' is-active' : ''}" aria-pressed="${value === filter}" data-widget-kind-filter="${
            esc(value)}">${esc(label)}</button>`;
        const chips = [chip('all', this.t('config.widgetKindsAll', 'All'))]
            .concat(groups.map(([group]) => chip(group, this.widgetTypeGroupLabel(group))))
            .concat(chip('custom', this.widgetTypeName('custom')))
            .join('');

        let order = 0;
        const card = (type, extra = '') => {
            const have = counts[type] || 0;
            const name = this.widgetTypeName(type);
            return `
                <article class="config-widget-kind" data-widget-kind="${esc(type)}" style="--i:${order++}">
                    <h4 class="config-widget-kind-name">
                        <span>${esc(name)}</span>
                        ${have ? `<span class="config-widget-kind-have">${esc((canAdd
                            ? this.t('config.widgetKindsHave', '{n} on this page')
                            : this.t('config.widgetKindsHaveAll', '{n} in use'))
                            .replace('{n}', String(have)))}</span>` : ''}
                    </h4>
                    <span class="config-widget-kind-sample" aria-hidden="true">${this.renderWidgetSample(type)}</span>
                    <p class="config-widget-kind-about">${esc(this.widgetTypeAbout(type))}</p>
                    <div class="config-widget-kind-foot">
                        ${extra}
                        <button type="button" class="config-btn config-btn--small" data-widget-add="${esc(type)}"
                            ${canAdd ? '' : 'disabled'}
                            aria-label="${esc(this.t('config.widgetsAddNamed', 'Add {name}').replace('{name}', name))}">${
                            esc(this.t('config.widgetKindsAdd', 'Add'))}</button>
                    </div>
                </article>`;
        };

        const sections = groups
            .filter(([group]) => filter === 'all' || filter === group)
            .map(([group, types]) => `
                <section class="config-widget-kind-group">
                    <h4 class="config-widget-kind-group-title">${esc(this.widgetTypeGroupLabel(group))}</h4>
                    <div class="config-widget-kind-grid">${types.map((type) => card(type)).join('')}</div>
                </section>`);
        if (filter === 'all' || filter === 'custom') {
            const more = `<button type="button" class="config-link-btn" data-widgets-goto="custom">${
                esc(this.t('config.widgetKindsHowCustom', 'How it works'))}</button>`;
            sections.push(`
                <section class="config-widget-kind-group">
                    <h4 class="config-widget-kind-group-title">${esc(this.t('config.widgetGroupCustom',
                        'And anything else: the Custom widget'))}</h4>
                    <div class="config-widget-kind-grid">${card('custom', more)}</div>
                </section>`);
        }

        return `
            <section class="config-panel config-widget-kinds">
                <div class="config-widget-kinds-head">
                    <h3 class="config-panel-title">${esc(this.t('config.widgetKindsTitle', 'Catalogue'))}
                        <span class="config-widget-kinds-count">${esc(this.t('config.widgetKindsCount', '{n} kinds')
                            .replace('{n}', String(total)))}</span></h3>
                    ${this.renderWidgetKindPagePicker()}
                </div>
                <div class="config-widget-kind-chips" role="group" aria-label="${
                    esc(this.t('config.widgetKindsFilter', 'Show one group'))}">${chips}</div>
                ${sections.join('')}
            </section>`;
    },

    /*
     * The Custom widget tab: a picture of the trip a figure makes -- from the
     * service, through the answer, to the tile -- then what it can do, the
     * services it already knows, and the limits the server holds it to. The
     * words are the ones the Add modal's explanation uses, so the two never
     * disagree.
     */
    renderCustomWidgetTab() {
        const esc = (v) => this.dash.escapeHtml(v);
        const t = (key, fallback) => esc(this.t(key, fallback));
        const code = (sample) => `<code class="config-widget-custom-code">${esc(sample)}</code>`;
        const formats = DashboardConfig.CUSTOM_FORMATS
            .map((format, i) => `<span class="config-widget-custom-format${i === 0 ? ' is-on' : ''}" style="--j:${i}">${
                esc(this.t(`config.widgetFormat.${format}`, format))}</span>`)
            .join('');

        const point = (icon, title, body, aside = '') => `
            <li class="config-widget-custom-card" style="--i:${point.n++}">
                <span class="config-widget-custom-icon" aria-hidden="true">${icon}</span>
                <span class="config-widget-custom-point-title">${title}</span>
                <span class="config-widget-custom-point-body">${body}</span>
                ${aside}
            </li>`;
        point.n = 0;

        const presetsApi = global.DashboardWidgetPresets;
        const known = (presetsApi?.PRESETS || []).filter((preset) => !preset.retired && !preset.variantOf);
        const shown = known.slice(0, 10);
        const presets = known.length ? `
            <section class="config-panel">
                <h3 class="config-panel-title">${t('config.widgetCustomRefPresetsTitle', 'Or start from a service already known')}
                    <span class="config-widget-kinds-count">${esc(String(known.length))}</span></h3>
                <p class="config-panel-note">${t('config.widgetCustomPresetsNote',
                    'Filled in for you: the address, the figures worth reading, and the header its API wants. Everything stays editable afterwards.')}</p>
                <div class="config-widget-custom-presets">${shown.map((preset, i) =>
                    `<span class="config-widget-custom-preset" style="--j:${i}">${esc(preset.name)}</span>`).join('')}${
                    known.length > shown.length
                        ? `<span class="config-widget-custom-preset is-more">+${esc(String(known.length - shown.length))}</span>`
                        : ''}</div>
            </section>` : '';

        return `
            <section class="config-panel config-widget-custom-how">
                <div class="config-widget-kinds-head">
                    <h3 class="config-panel-title">${t('config.widgetCustomHowTitle', 'How it works')}</h3>
                    <button type="button" class="config-btn config-btn--primary" data-widget-add="custom">${
                        esc(this.t('config.widgetsAddNamed', 'Add {name}').replace('{name}', this.widgetTypeName('custom')))}</button>
                </div>
                <p class="config-panel-note">${t('config.widgetCustomTabLead',
                    'Every other kind in the Catalogue reads something nextDash already knows. The Custom widget reads a figure out of any service that answers JSON, so a tile can show what your own machines are doing without waiting for nextDash to grow a widget for them.')}</p>
                <div class="config-widget-custom-flow" aria-hidden="true">
                    <div class="config-widget-custom-node">
                        <span class="config-widget-custom-node-label">${t('config.widgetCustomFlowService', 'Your service')}</span>
                        <span class="config-widget-custom-node-path">GET /api/v3/queue</span>
                        <span class="config-widget-custom-node-host">sonarr.lan:8989</span>
                    </div>
                    <span class="config-widget-custom-wire"></span>
                    <div class="config-widget-custom-node">
                        <span class="config-widget-custom-node-label">${t('config.widgetCustomFlowAnswer', 'The answer')}</span>
                        <span class="config-widget-custom-json">{
  "totalRecords": <mark>7</mark>,
  "paused": <mark>2</mark>,
  "records": [ … ]
}</span>
                    </div>
                    <span class="config-widget-custom-wire is-second"></span>
                    <div class="config-widget-custom-node is-tile">
                        <span class="config-widget-custom-node-label">// ${t('config.widgetCustomFlowTile', 'downloads')}</span>
                        <span class="config-widget-custom-figures">
                            <span><b>7</b>${t('config.widgetCustomFlowQueued', 'queued')}</span>
                            <span><b>2</b>${t('config.widgetCustomFlowPaused', 'paused')}</span>
                        </span>
                    </div>
                </div>
            </section>
            <ul class="config-widget-custom-cards">
                ${point('⇢', t('config.widgetCustomRefAddressTitle', 'An address that answers JSON'),
                    t('config.widgetCustomRefAddressBody',
                        'Any http or https endpoint, fetched by the server rather than by the browser — so a service on your own network works, and no key ever reaches the page. GET, or POST with a body for the services that insist.'))}
                ${point('⌗', t('config.widgetCustomRefPathsTitle', 'Paths into the answer'),
                    t('config.widgetCustomRefPathsBody',
                        'Name the value you want and nothing else — the path walks objects and arrays. Up to eight figures on one tile; more than that is a report rather than a glance.'),
                    code('server.disk[0].used'))}
                ${point('◐', t('config.widgetCustomRefFormatsTitle', 'A shape per figure'),
                    t('config.widgetCustomRefFormatsBody', 'The same number reads differently depending on what it is:'),
                    `<span class="config-widget-custom-formats">${formats}</span>`)}
                ${point('≡', t('config.widgetCustomRefListTitle', 'Or a list instead of figures'),
                    t('config.widgetCustomRefListBody',
                        'Point at an array and the tile draws its entries as rows, up to twenty — the downloads running now, the last few errors.'))}
                ${point('⚿', t('config.widgetCustomRefAuthTitle', 'A sign-in that stays out of your backups'),
                    t('config.widgetCustomRefAuthBody',
                        'An API key in a header, or a username and password. Kept in a separate file that no export or backup ZIP includes; the widget itself stores only a reference to it.'))}
                ${point('↻', t('config.widgetCustomRefCacheTitle', 'Asked on a schedule you set'),
                    t('config.widgetCustomRefCacheBody',
                        'Anywhere between 30 seconds and a day, five minutes by default. One answer is shared by everyone looking at the dashboard, so a wall display costs the service nothing extra.'))}
            </ul>
            ${presets}
            <section class="config-panel">
                <h3 class="config-panel-title">${t('config.widgetCustomLimitsTitle', 'What it will not do')}</h3>
                <div class="config-widget-custom-limits">
                    <span><b>${t('config.widgetCustomLimitRead', 'read-only')}</b> GET · POST</span>
                    <span><b>8 s</b> ${t('config.widgetCustomLimitTime', 'to answer')}</span>
                    <span><b>1 MB</b> ${t('config.widgetCustomLimitSize', 'read at most')}</span>
                </div>
                <p class="config-panel-note">${t('config.widgetCustomRefLimits',
                    'What it will not do is change anything. A tile reads, and the two methods it offers are the two that ask a question. An answer has eight seconds to arrive and is read up to a megabyte.')}</p>
            </section>`;
    },

    });

    global.DashboardConfigWidgetCatalogueReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
