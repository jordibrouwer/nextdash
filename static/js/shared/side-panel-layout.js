'use strict';
/**
 * The Bookmarks view's side panel layout, for the other views' side panels.
 *
 * A head (icon, name, a badge, ⋯), the address and where it stands, the main
 * buttons in one row; tabs where there is more than one kind of thing to
 * read; and each pane a summary on top with the rest in the tinted accordion.
 * Built from the Bookmarks panel's own classes (config-bookmarks-workbench.css),
 * so the three views cannot drift apart in how they look.
 *
 * Markup only, plus bind() for what every such panel does: the ⋯ menu, the
 * accordion remembering what was open, and the tabs. What a button does stays
 * with the view: bind() hands every [data-slp-action] click to onAction.
 */
(function (global) {
    const read = (key) => {
        try {
            return JSON.parse(global.localStorage?.getItem(key) || 'null');
        } catch {
            return null;
        }
    };
    const write = (key, value) => {
        try {
            global.localStorage?.setItem(key, JSON.stringify(value));
        } catch {
            // Remembering is a nicety; a panel without storage still works.
        }
    };
    const accKey = (group) => `nextdash.${group}.acc`;
    const tabKey = (group) => `nextdash.${group}.tab`;

    const SidePanelLayout = {
        /**
         * icon: markup; badge: { text, tone }; more: [{ action, label, danger }];
         * url: an address to link; where: one line under it; actions:
         * [{ action, label, primary, title }].
         */
        head(esc, { icon = '', title = '', badge = null, more = [], url = '', urlLabel = '', where = '', actions = [] }) {
            const button = (a, extra = '') => `<button type="button" class="config-btn config-btn--small${a.primary ? ' config-btn--primary' : ''}${a.danger ? ' config-btn--danger' : ''}${extra}"
                data-slp-action="${esc(a.action)}"${a.title ? ` title="${esc(a.title)}"` : ''}>${esc(a.label)}</button>`;
            return `
                <header class="config-bm-panel-head config-bm-panel-head--single">
                    <div class="config-bm-panel-heading">
                        <span class="config-bm-panel-icon">${icon}</span>
                        <span class="config-bm-panel-title" title="${esc(title)}">${esc(title)}</span>
                        ${badge ? `<span class="config-bm-score slp-badge" data-tone="${esc(badge.tone || '')}">${esc(badge.text)}</span>` : ''}
                        ${more.length ? `<span class="config-bm-more">
                            <button type="button" class="config-btn config-btn--small" data-slp-more aria-haspopup="menu" aria-expanded="false"
                                    aria-label="${esc(this.moreLabel || 'More actions')}">⋯</button>
                            <div class="config-bm-more-menu" role="menu" data-slp-more-menu hidden>${more.map((a) => button(a)).join('')}</div>
                        </span>` : ''}
                    </div>
                    ${url ? `<a class="config-bm-panel-url" href="${esc(url)}" title="${esc(url)}" target="_blank" rel="noopener noreferrer" data-slp-url>${esc(urlLabel || url)}</a>` : ''}
                    ${where ? `<p class="config-bm-panel-where" title="${esc(where)}">${esc(where)}</p>` : ''}
                    ${actions.length ? `<div class="config-bm-panel-actions">${actions.map((a) => button(a)).join('')}</div>` : ''}
                </header>`;
        },

        /** One accordion section; open as last left, else openByDefault. */
        acc(esc, group, name, label, answer, body, openByDefault = false) {
            const stored = read(accKey(group));
            const open = Array.isArray(stored) ? stored.includes(name) : openByDefault;
            return `<details class="config-bm-acc" data-slp-acc="${esc(name)}" data-slp-acc-group="${esc(group)}"${open ? ' open' : ''}>
                <summary><span>${esc(label)}</span><span class="config-bm-acc-answer">${esc(answer)}</span></summary>
                <div class="lvs-drawer-section-body">${body}</div>
            </details>`;
        },

        accList(sections) {
            return `<div class="config-bm-acc-list">${sections.join('')}</div>`;
        },

        /** The summary block on top of a pane. */
        viz(inner) {
            return `<div class="config-bm-details-viz">${inner}</div>`;
        },

        chip(esc, text, cls = '') {
            return `<span class="config-bm-details-chip${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;
        },

        /** tabs: [{ name, label }]; the one on show is the last chosen, else the first. */
        tabs(esc, group, tabs) {
            const active = this.activeTab(group, tabs);
            return `<div class="config-bm-tabs" role="tablist" style="grid-template-columns: repeat(${tabs.length}, 1fr)">
                ${tabs.map((tab) => `<button type="button" class="config-bm-tab${tab.name === active ? ' is-active' : ''}" role="tab"
                    data-slp-tab="${esc(tab.name)}" aria-selected="${tab.name === active ? 'true' : 'false'}">${esc(tab.label)}</button>`).join('')}
            </div>`;
        },

        pane(esc, group, tabs, name, html) {
            const active = this.activeTab(group, tabs);
            return `<section class="config-bm-pane" data-slp-pane="${esc(name)}" role="tabpanel"${name === active ? '' : ' hidden'}>${html}</section>`;
        },

        activeTab(group, tabs) {
            const stored = read(tabKey(group));
            return tabs.some((tab) => tab.name === stored) ? stored : tabs[0]?.name;
        },

        /**
         * onAction(action, button) for every [data-slp-action]; onTab(name)
         * after a tab is switched. Bound once per root.
         */
        bind(root, { group, onAction, onTab } = {}) {
            if (!root || root.dataset.slpBound === '1') return;
            root.dataset.slpBound = '1';
            const closeMore = () => {
                root.querySelectorAll('[data-slp-more-menu]').forEach((m) => { m.hidden = true; });
                root.querySelectorAll('[data-slp-more]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
            };
            root.addEventListener('click', (e) => {
                const more = e.target.closest('[data-slp-more]');
                if (more) {
                    const menu = more.parentElement?.querySelector('[data-slp-more-menu]');
                    if (menu) {
                        menu.hidden = !menu.hidden;
                        more.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
                    }
                    return;
                }
                const tab = e.target.closest('[data-slp-tab]');
                if (tab) {
                    const name = tab.getAttribute('data-slp-tab');
                    write(tabKey(group), name);
                    root.querySelectorAll('[data-slp-tab]').forEach((t) => {
                        const on = t === tab;
                        t.classList.toggle('is-active', on);
                        t.setAttribute('aria-selected', on ? 'true' : 'false');
                    });
                    root.querySelectorAll('[data-slp-pane]').forEach((p) => { p.hidden = p.getAttribute('data-slp-pane') !== name; });
                    onTab?.(name);
                    return;
                }
                const action = e.target.closest('[data-slp-action]');
                closeMore();
                if (action) onAction?.(action.getAttribute('data-slp-action'), action, e);
            });
            // The accordion remembers what was open, per view.
            root.addEventListener('toggle', (e) => {
                const acc = e.target;
                if (!(acc instanceof HTMLElement) || !acc.matches('[data-slp-acc]')) return;
                const g = acc.getAttribute('data-slp-acc-group');
                const open = [...root.querySelectorAll(`[data-slp-acc-group="${CSS.escape(g)}"]`)]
                    .filter((d) => d.open).map((d) => d.getAttribute('data-slp-acc'));
                write(accKey(g), open);
            }, true);
        },
    };

    global.SidePanelLayout = SidePanelLayout;
}(typeof window !== 'undefined' ? window : globalThis));
