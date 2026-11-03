/**
 * Tabs: several widgets of one page in a single tile.
 *
 * A stack is an ordinary widget block -- it drags, folds, renames and goes wide
 * like the ones beside it -- whose body is a tab strip and the panel of the
 * tab showing. The widgets it holds are named by id in its config
 * (`members`), stay widgets of the page, and are left out of the grid while a
 * stack holds them (see DashboardRenderCore.stackMemberIds).
 *
 * Only the tab in view is drawn, and only its clock runs: a tile in a hidden
 * tab asks nothing of its service. The panel carries the member's id and type
 * under its own class so the render core's beat, refresh and redraw find it
 * where they would find a block.
 *
 * Which tab was last open is kept in this browser, per stack, as a convenience
 * and nothing more; it is not a setting and is not sent anywhere.
 */
(function () {
    'use strict';

    const STORE = 'nextdash.stackTab.v1';

    function remembered(stackId) {
        try {
            return JSON.parse(localStorage.getItem(STORE) || '{}')[stackId] || '';
        } catch (_error) {
            return '';
        }
    }

    function remember(stackId, memberId) {
        try {
            const all = JSON.parse(localStorage.getItem(STORE) || '{}');
            all[stackId] = memberId;
            localStorage.setItem(STORE, JSON.stringify(all));
        } catch (_error) {
            // Private window or blocked storage: the tab simply is not kept.
        }
    }

    function label(dash, key, fallback) {
        return window.DashboardWidgetUtils?.label?.(dash, key, fallback) || fallback;
    }

    /** The members of a stack that exist, are shown, and are not stacks. */
    function membersOf(widget, dash) {
        const ids = Array.isArray(widget?.config?.members) ? widget.config.members : [];
        return ids
            .map((id) => (dash.widgets || []).find((w) => w?.id === id))
            .filter((w) => w && w.type !== 'stack' && w.config?.enabled !== false
            && dash.renderCore?.widgetIsScheduledNow?.(w) !== false);
    }

    function memberName(member, dash) {
        const given = String(member.title || '').trim();
        return given || dash.renderCore?.widgetTypeLabel?.(member.type) || member.type;
    }

    function render(body, widget, dash) {
        const core = dash.renderCore;
        const members = membersOf(widget, dash);
        // Redrawn: every clock this stack started goes first, so a tab that is
        // no longer there does not keep asking.
        (widget._stackTimers || []).forEach((id) => core?.stopWidgetTimer?.(id));
        widget._stackTimers = [];

        body.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = 'dashboard-widget-stack';
        body.appendChild(wrap);

        if (!members.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = label(dash, 'dashboard.widgetStackEmpty',
                'Nothing in these tabs yet. Pick widgets under Config → Widgets.');
            wrap.appendChild(empty);
            return;
        }

        const strip = document.createElement('div');
        strip.className = 'dashboard-stack-tabs';
        strip.setAttribute('role', 'tablist');
        wrap.appendChild(strip);
        const panel = document.createElement('div');
        panel.className = 'dashboard-stack-panel dashboard-widget-member';
        panel.setAttribute('role', 'tabpanel');
        wrap.appendChild(panel);

        const tabs = new Map();
        let current = '';

        function show(memberId, { focus = false } = {}) {
            const member = members.find((m) => m.id === memberId) || members[0];
            current = member.id;
            remember(widget.id, current);
            tabs.forEach((tab, id) => {
                const on = id === current;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
                tab.classList.toggle('dashboard-stack-tab--on', on);
            });
            if (focus) tabs.get(current)?.focus();

            (widget._stackTimers || []).forEach((id) => core?.stopWidgetTimer?.(id));
            widget._stackTimers = [];
            panel.dataset.widgetId = member.id;
            panel.dataset.widgetType = member.type || '';
            panel.setAttribute('aria-labelledby', `stack-tab-${widget.id}-${member.id}`);
            panel.replaceChildren();
            const inner = document.createElement('div');
            inner.className = 'dashboard-widget-body';
            inner.setAttribute('role', 'presentation');
            panel.appendChild(inner);
            const renderer = window.DashboardWidgets?.[member.type];
            if (typeof renderer === 'function') {
                renderer(inner, member, dash);
            } else {
                inner.textContent = label(dash, 'dashboard.widgetUnknown', 'This widget is not available.');
                inner.classList.add('dashboard-widget-body--empty');
            }
            // Only the tab in view keeps a clock.
            if (core?.startWidgetTimer && core.widgetPollSpec?.(member)) {
                core.startWidgetTimer(member);
                widget._stackTimers.push(member.id);
            }
        }

        members.forEach((member, i) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'dashboard-stack-tab';
            tab.id = `stack-tab-${widget.id}-${member.id}`;
            tab.setAttribute('role', 'tab');
            tab.textContent = memberName(member, dash);
            tab.title = tab.textContent;
            tab.addEventListener('click', () => show(member.id));
            tab.addEventListener('keydown', (event) => {
                const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
                const edge = { Home: 0, End: members.length - 1 }[event.key];
                if (step === undefined && edge === undefined) return;
                event.preventDefault();
                event.stopPropagation();
                const to = edge !== undefined ? edge : (i + step + members.length) % members.length;
                show(members[to].id, { focus: true });
            });
            tabs.set(member.id, tab);
            strip.appendChild(tab);
        });

        const saved = remembered(widget.id);
        show(members.some((m) => m.id === saved) ? saved : members[0].id);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.stack = render;
}());
