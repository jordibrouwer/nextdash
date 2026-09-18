/**
 * Config → Appearance and Behavior as a hub.
 *
 * Both sections were a strip of tabs over stacks of panels with every setting
 * at the same weight, so a reader who had just installed nextDash had to read
 * all of them to find the three that change how the dashboard looks. The start
 * screen is a set of tiles that say what is set; behind each tile is a group
 * page that leads with the few choices that matter, drawn, and keeps the rest
 * under "More settings".
 *
 * This file only describes and draws. The settings, their controls, saving,
 * resetting and the search all stay in dashboard-config.js; a group is one or
 * more of the tabs that already exist, so every deep link and every panel keeps
 * working, and the tab ids stay on the page as links.
 */
(function (global) {
    'use strict';

    const GROUPS = {
        appearance: [
            { id: 'theme', icon: '◐', tabs: ['general'], titleKey: 'config.hubThemeTitle', title: 'Theme',
                noteKey: 'config.hubThemeNote', note: 'Colours, type and the page behind your bookmarks.' },
            { id: 'grid', icon: '▦', tabs: ['layout', 'display'], titleKey: 'config.hubGridTitle', title: 'Grid',
                noteKey: 'config.hubGridNote', note: 'How many columns, how close together, and what each row shows.' },
            { id: 'header', icon: '▭', tabs: ['header', 'buttonbar'], titleKey: 'config.hubHeaderTitle', title: 'Header & buttons',
                noteKey: 'config.hubHeaderNote', note: 'The strip along the top: page tabs, title and the action buttons.' },
            { id: 'datetime', icon: '☀', tabs: ['datetime'], titleKey: 'config.hubDateTitle', title: 'Date & weather',
                noteKey: 'config.hubDateNote', note: 'The clock, the date line and the weather beside it.' },
            { id: 'custom', icon: '✎', tabs: ['custom-themes'], titleKey: 'config.hubCustomTitle', title: 'Custom themes',
                noteKey: 'config.hubCustomNote', note: 'Make a theme of your own, or change the colours of one that ships.' },
        ],
        behavior: [
            { id: 'general', icon: '⚙', tabs: ['general'], titleKey: 'config.hubGeneralTitle', title: 'General',
                noteKey: 'config.hubGeneralNote', note: 'Language, how links open, and the keys that work everywhere.' },
            { id: 'search', icon: '⌕', tabs: ['search'], titleKey: 'config.hubSearchTitle', title: 'Search',
                noteKey: 'config.hubSearchNote', note: 'What the search panel finds and what typing a shortcut does.' },
            { id: 'inbox', icon: '⤓', tabs: ['inbox'], titleKey: 'config.hubInboxTitle', title: 'Inbox',
                noteKey: 'config.hubInboxNote', note: 'Links you save for later, and where a pasted link goes.' },
            { id: 'fresh', icon: '✦', tabs: ['fresh'], titleKey: 'config.hubFreshTitle', title: 'Fresh',
                noteKey: 'config.hubFreshNote', note: 'New items from the feeds of the sites you bookmarked.' },
            { id: 'status', icon: '♥', tabs: ['status'], titleKey: 'config.hubStatusTitle', title: 'Status & health',
                noteKey: 'config.hubStatusNote', note: 'Whether your links still answer, and who hears when one stops.' },
            { id: 'privacy', icon: '◌', tabs: ['privacy'], titleKey: 'config.hubPrivacyTitle', title: 'Privacy',
                noteKey: 'config.hubPrivacyNote', note: 'What nextDash sends anywhere, and what it never does.' },
        ],
    };

    /** The two to four choices a tab leads with. Everything else is "More settings". */
    const BASICS = {
        appearance: {
            layout: ['columnsPerRow', 'densityMode'],
            display: ['shortcutDisplay', 'rowHighlight'],
            header: ['pageSwitcherStyle', 'headerButtonStyle', 'showPageNamesInTabs'],
            buttonbar: ['actionBarPosition', 'actionBarAutoHideSeconds', 'actionBarEnabled'],
            // The location leads: without one the weather line shows nothing,
            // and it was the one answer of the four kept behind More settings.
            datetime: ['weatherLocation', 'timeFormat', 'weatherUnit', 'headerClockPlacement'],
        },
        behavior: {
            general: ['language', 'openInNewTab', 'lockLayout'],
            search: ['shortcutOpenMode', 'includeFindersInSearch', 'enableFuzzySuggestions'],
            inbox: ['inboxEnabled', 'pasteUrlQuickAdd'],
            fresh: ['feedsEnabled'],
            status: ['healthAutoRecheckEnabled', 'monitorEmphasis'],
            privacy: ['analyticsOptIn', 'updateCheckEnabled'],
        },
    };

    /** Number settings offered as a short row of choices on their card. */
    const NUMBER_CHOICES = {
        columnsPerRow: [2, 3, 4, 5, 6],
    };

    // Options whose label is an example rather than a name: the time format
    // offers "23:59" and "11:59 PM", which on a tile read as a clock stuck at
    // one minute to midnight unless the setting is named in front of them.
    const LABELLED_OPTIONS = new Set(['timeFormat']);

    /** What each Behavior group looks like, drawn instead of a live preview. */
    const ILLUSTRATIONS = {
        general: { art: '<span class="hub-ill-key">!</span><span class="hub-ill-key">&gt;</span><span class="hub-ill-key">⇧S</span>',
            key: 'config.hubIllGeneral', text: 'Keys like ! for the cheat sheet, > for search and Shift+S for config work on every page.' },
        search: { art: '<span class="hub-ill-bar">&gt; gh<i></i></span>',
            key: 'config.hubIllSearch', text: 'Type the letters of a shortcut: with "opens at once", GitHub opens the moment "gh" is unique.' },
        inbox: { art: '<span class="hub-ill-row">⌘V → Inbox</span>',
            key: 'config.hubIllInbox', text: 'Paste a link anywhere on the dashboard and it lands in the inbox, to be filed later.' },
        fresh: { art: '<span class="hub-ill-row">● 3 new</span>',
            key: 'config.hubIllFresh', text: 'Sites with a feed show how many new items they have, right on their row.' },
        status: { art: '<span class="hub-ill-dot is-ok"></span><span class="hub-ill-dot is-bad"></span><span class="hub-ill-dot is-ok"></span>',
            key: 'config.hubIllStatus', text: 'A dot per link: green answers, red does not. Monitored links are checked on their own timer.' },
        privacy: { art: '<span class="hub-ill-row">∅ → nextDash</span>',
            key: 'config.hubIllPrivacy', text: 'Nothing leaves your server unless you switch it on here.' },
    };

    const groups = (section) => GROUPS[section] || [];

    function groupForTab(section, tab) {
        return groups(section).find((g) => g.tabs.includes(tab)) || null;
    }

    function basicsFor(section, tab) {
        return (BASICS[section] && BASICS[section][tab]) || [];
    }

    /** The schema control behind a field, from the config's own schema. */
    function controlFor(config, field) {
        const panels = config.behaviorSchema?.() || [];
        for (const panel of panels) {
            const hit = (panel.controls || []).find((c) => c && c.field === field);
            if (hit) return hit;
        }
        return null;
    }

    function optionLabel(config, control, value) {
        const opt = (control.options || []).find((o) => String(o.value) === String(value));
        return opt ? opt.label : String(value);
    }

    /** The tile's one-line answer to "what is set here". */
    function summary(config, section, group) {
        const s = config.dash?.settings || {};
        const esc = (v) => config.dash.escapeHtml(v);
        const bits = [];
        if (section === 'appearance' && group.id === 'theme') {
            const theme = s.theme || 'dark';
            bits.push(config.themeDisplayName?.(theme) || theme);
        } else if (group.id === 'custom') {
            const count = Object.keys(config._colorsData?.custom || {}).length;
            bits.push(count
                ? config.t('config.hubCustomCount', '{n} made').replace('{n}', String(count))
                : config.t('config.hubCustomNone', 'Make your first'));
        } else {
            group.tabs.forEach((tab) => {
                basicsFor(section, tab).slice(0, 2).forEach((field) => {
                    const control = controlFor(config, field);
                    if (!control) return;
                    const value = s[field];
                    // The form's labels carry their own colon ("Weather
                    // location:", "Columns per row:" -- a full-width one in
                    // zh), which the summary then doubled or left dangling.
                    const label = String(control.label || '').replace(/\s*[:：]\s*$/, '');
                    if (control.type === 'checkbox') {
                        bits.push(`${label}: ${value ? config.t('config.hubOn', 'on') : config.t('config.hubOff', 'off')}`);
                    } else if (control.options) {
                        const chosen = optionLabel(config, control, value);
                        bits.push(LABELLED_OPTIONS.has(field) ? `${label}: ${chosen}` : chosen);
                    } else if (NUMBER_CHOICES[field]) {
                        bits.push(`${value} ${label.toLowerCase()}`);
                    } else if (value != null && value !== '') {
                        bits.push(`${label}: ${value}`);
                    }
                });
            });
        }
        return bits.slice(0, 3).map(esc).join(' · ');
    }

    function changedInGroup(config, section, group) {
        const s = config.dash?.settings || {};
        const meta = global.DashboardConfig?.FIELD_META || {};
        return group.tabs.some((tab) => (config.panelsFor?.(section, tab) || []).some((panel) =>
            (panel.controls || []).some((c) => c && c.field && meta[c.field]
                && 'def' in meta[c.field] && s[c.field] !== undefined
                && String(s[c.field]) !== String(meta[c.field].def))));
    }

    function tabAttr(section) {
        return section === 'appearance' ? 'data-appearance-tab' : 'data-behavior-tab';
    }

    function tabLabel(config, section, tab) {
        return section === 'appearance' ? config.appearanceTabLabel(tab) : config.behaviorTabLabel(tab);
    }

    function renderStart(config, section) {
        const esc = (v) => config.dash.escapeHtml(v);
        const attr = tabAttr(section);
        const tiles = groups(section).map((g) => {
            const changed = changedInGroup(config, section, g);
            const links = g.tabs.length > 1
                ? `<span class="hub-tile-links">${g.tabs.slice(1).map((tab) =>
                    `<button type="button" class="hub-tile-link" ${attr}="${esc(tab)}">${esc(tabLabel(config, section, tab))}</button>`).join('')}</span>`
                : '';
            return `
                <div class="hub-tile" role="listitem" data-hub-group="${esc(g.id)}">
                    <button type="button" class="hub-tile-main" ${attr}="${esc(g.tabs[0])}">
                        <span class="hub-tile-icon" aria-hidden="true">${esc(g.icon)}</span>
                        <span class="hub-tile-title">${esc(config.t(g.titleKey, g.title))}${changed ? `<span class="hub-tile-changed" title="${esc(config.t('config.hubChanged', 'Differs from the default'))}"></span>` : ''}</span>
                        <span class="hub-tile-note">${esc(config.t(g.noteKey, g.note))}</span>
                        <span class="hub-tile-summary">${summary(config, section, g)}</span>
                    </button>
                    ${links}
                </div>`;
        }).join('');
        return `<div class="hub-start" data-hub-start="${esc(section)}" role="list">${tiles}</div>`;
    }

    /** Breadcrumb, the group's explanation and, for a group of two tabs, its own tab strip. */
    function renderGroupHead(config, section, tab) {
        const esc = (v) => config.dash.escapeHtml(v);
        const g = groupForTab(section, tab);
        if (!g) return '';
        const attr = tabAttr(section);
        const sectionName = section === 'appearance'
            ? config.t('config.sectionAppearance', 'Appearance')
            : config.t('config.sectionBehavior', 'Behavior');
        // Every tab of the section, so the next group is one click away rather
        // than Back and a tile; the current group's tabs are marked as its own.
        const allTabs = (section === 'appearance'
            ? config.constructor.APPEARANCE_TABS
            : config.constructor.BEHAVIOR_TABS) || groups(section).flatMap((grp) => grp.tabs);
        const strip = `<div class="config-subtabs hub-subtabs" role="tablist">${allTabs.map((t) => {
            const on = t === tab;
            const mine = g.tabs.includes(t);
            return `<button type="button" class="config-subtab${on ? ' is-active' : ''}${mine ? ' is-in-group' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="config-${section}-body" ${attr}="${esc(t)}">${esc(tabLabel(config, section, t))}</button>`;
        }).join('')}</div>`;
        return `
            <div class="hub-head">
                <button type="button" class="hub-back" data-hub-back="${esc(section)}">← ${esc(sectionName)}</button>
                <span class="hub-crumb-sep" aria-hidden="true">/</span>
                <h3 class="hub-title">${esc(config.t(g.titleKey, g.title))}</h3>
            </div>
            <p class="hub-intro">${esc(config.t(g.noteKey, g.note))}</p>
            ${strip}`;
    }

    function renderBasics(config, section, tab) {
        const esc = (v) => config.dash.escapeHtml(v);
        const s = config.dash?.settings || {};
        const cards = basicsFor(section, tab).map((field) => {
            const control = controlFor(config, field);
            if (!control) {
                console.warn(`[config-hub] basics field ${field} is not in the schema`);
                return '';
            }
            const current = s[field];
            /*
             * A card that is typed into rather than chosen from.
             *
             * The basics are a row of choices, which is why they are cards at
             * all -- but the weather location is a place name, and it is the
             * answer the weather line cannot do without. Left out of the row it
             * was the only one of its tab's four behind More settings.
             */
            if (control.type === 'text') {
                return `
                <div class="hub-card hub-card--text" data-hub-card="${esc(field)}" data-hub-special="${esc(control.special || '')}">
                    <label class="hub-card-title" for="hub-text-${esc(field)}">${esc(control.label)}</label>
                    <input type="text" id="hub-text-${esc(field)}" class="hub-text"
                           value="${esc(current == null ? '' : String(current))}"
                           placeholder="${esc(control.placeholder || '')}"
                           data-hub-text="${esc(field)}" data-hub-special="${esc(control.special || '')}">
                </div>`;
            }
            let options;
            if (control.type === 'checkbox') {
                options = [
                    { value: true, label: config.t('config.hubOn', 'on') },
                    { value: false, label: config.t('config.hubOff', 'off') },
                ];
            } else if (Array.isArray(control.options) && control.options.length) {
                options = control.options;
            } else if (NUMBER_CHOICES[field]) {
                options = NUMBER_CHOICES[field].map((n) => ({ value: n, label: String(n) }));
            } else {
                return '';
            }
            const choices = options.map((o) => {
                const on = control.type === 'checkbox'
                    ? Boolean(current) === o.value
                    : String(current) === String(o.value);
                const art = control.art && global.SettingArt?.render
                    ? global.SettingArt.render(control.art, o.value)
                    : '';
                return `<button type="button" class="hub-choice${on ? ' is-active' : ''}" aria-pressed="${on}"
                            data-hub-field="${esc(field)}" data-hub-value="${esc(String(o.value))}"
                            data-hub-type="${esc(control.type === 'checkbox' ? 'bool' : (typeof o.value === 'number' ? 'number' : 'string'))}"
                            data-hub-special="${esc(control.special || '')}"${control.disabled ? ' disabled' : ''}>${art}<span class="hub-choice-label">${esc(o.label)}</span></button>`;
            }).join('');
            return `
                <div class="hub-card" data-hub-card="${esc(field)}" data-hub-special="${esc(control.special || '')}">
                    <div class="hub-card-title">${esc(control.label)}</div>
                    <div class="hub-choices" role="group" aria-label="${esc(control.label)}">${choices}</div>
                </div>`;
        }).join('');
        return cards ? `<div class="hub-basics">${cards}</div>` : '';
    }

    /** A drawing of the dashboard that follows the Appearance settings. */
    function renderPreview(config) {
        const s = config.dash?.settings || {};
        const esc = (v) => config.dash.escapeHtml(v);
        const cols = Math.min(6, Math.max(1, Number(s.columnsPerRow) || 4));
        const place = ['bottom', 'left', 'right', 'menu'].includes(s.actionBarPosition) ? s.actionBarPosition : 'header';
        const switcher = ['text', 'segmented', 'compact'].includes(s.pageSwitcherStyle) ? s.pageSwitcherStyle : 'classic';
        const density = s.densityMode || 'comfortable';
        const barState = s.actionBarEnabled === false ? 'off'
            : (Number(s.actionBarAutoHideSeconds) > 0 && ['bottom', 'left', 'right'].includes(place) ? 'sliding' : 'on');
        const cells = Array.from({ length: cols * 2 }, () => '<i></i>').join('');
        const tabs = switcher === 'compact'
            ? '<span class="hub-pv-tab is-on">main ▾</span>'
            : `<span class="hub-pv-tab is-on">${s.showPageNamesInTabs ? 'main' : '1'}</span><span class="hub-pv-tab">${s.showPageNamesInTabs ? 'web' : '2'}</span><span class="hub-pv-tab">${s.showPageNamesInTabs ? 'media' : '3'}</span>`;
        return `
            <div class="hub-preview" aria-hidden="true"
                 data-preview-cols="${cols}" data-preview-actions="${esc(place)}" data-preview-bar="${barState}"
                 data-preview-switcher="${esc(switcher)}" data-preview-density="${esc(density)}"
                 data-preview-buttons="${s.headerButtonStyle === 'plated' ? 'plated' : 'plain'}">
                <div class="hub-pv-head">
                    <span class="hub-pv-title">main</span>
                    <span class="hub-pv-tabs">${tabs}</span>
                    <span class="hub-pv-dest">${place === 'header' ? '<b></b><b></b>' : (place === 'menu' ? '<b></b>' : '')}<em></em><em></em></span>
                </div>
                <div class="hub-pv-grid" style="--pv-cols:${cols}">${cells}</div>
                <div class="hub-pv-dock"></div>
            </div>`;
    }

    function renderIllustration(config, tab) {
        const ill = ILLUSTRATIONS[tab];
        if (!ill) return '';
        return `
            <div class="hub-ill">
                <div class="hub-ill-art" aria-hidden="true">${ill.art}</div>
                <p class="hub-ill-text">${config.dash.escapeHtml(config.t(ill.key, ill.text))}</p>
            </div>`;
    }

    /** Wraps a group's existing body: basics, then More settings, then the side column. */
    function renderGroup(config, section, tab, body) {
        const basics = renderBasics(config, section, tab);
        const key = `${section}:${tab}`;
        let open = false;
        try { open = global.localStorage?.getItem(`nextdash.hubMore.${key}`) === '1'; } catch { /* private window */ }
        // With no basics there is nothing to put the rest behind.
        const more = basics
            ? `<details class="hub-more" data-hub-more="${config.dash.escapeHtml(key)}"${open ? ' open' : ''}>
                   <summary>${config.dash.escapeHtml(config.t('config.hubMore', 'More settings'))}</summary>
                   <div class="hub-more-body">${body}</div>
               </details>`
            : body;
        const side = section === 'appearance'
            ? `<aside class="hub-side"><p class="hub-side-label">${config.dash.escapeHtml(config.t('config.hubPreview', 'Preview'))}</p><div data-hub-preview>${renderPreview(config)}</div></aside>`
            : `<aside class="hub-side">${renderIllustration(config, tab)}</aside>`;
        return `
            ${renderGroupHead(config, section, tab)}
            <div class="hub-group">
                <div class="hub-group-main">${basics}${more}</div>
                ${side}
            </div>`;
    }

    function repaintPreview(config) {
        document.querySelectorAll('[data-hub-preview]').forEach((host) => {
            host.innerHTML = renderPreview(config);
        });
    }

    global.ConfigHub = {
        GROUPS, BASICS, groups, groupForTab, basicsFor,
        renderStart, renderGroup, renderBasics, renderPreview, repaintPreview,
    };
}(typeof window !== 'undefined' ? window : globalThis));
