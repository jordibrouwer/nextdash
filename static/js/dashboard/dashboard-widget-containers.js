/**
 * Container list: the containers themselves, one row each.
 *
 * The containers widget counts; this one names. A row is a name with its
 * state as a tone and, beside it, how long it has run -- or, when something is
 * wrong, what: "unhealthy" says more than "1 h" about a container that keeps
 * restarting.
 *
 * `rows` is per column. A tile drawn one wide is one file of rows; two wide,
 * the same list pairs into two files and shows twice as many. The rows past
 * the narrow count are built anyway and hidden by the container query, the
 * way every widget here answers to the width it got rather than the one it
 * asked for, so narrowing the window needs no refetch.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    const STOPPED = new Set(['exited', 'dead', 'created', 'removing']);

    /*
     * What needs you, most first: a failing healthcheck, then anything down,
     * then an image with a newer tag. The rest are fine and share a rank.
     */
    function problemRank(c) {
        if (c.health === 'unhealthy') return 0;
        if (STOPPED.has(c.state) || c.state === 'restarting') return 1;
        if (c.update?.status === 'available') return 2;
        return 3;
    }

    function byName(a, b) {
        return String(a.name).localeCompare(String(b.name));
    }

    /** Highest first; a container with no reading (stopped, sampler off) last. */
    function byUsage(field) {
        return (a, b) => {
            const va = a.usage?.[field];
            const vb = b.usage?.[field];
            if (va == null || vb == null) return (va == null) - (vb == null) || byName(a, b);
            return vb - va || byName(a, b);
        };
    }

    function formatMem(bytes) {
        const mib = bytes / (1024 * 1024);
        return mib < 1024 ? `${Math.round(mib)} MiB` : `${(mib / 1024).toFixed(1)} GiB`;
    }

    const SORTS = {
        problems: (a, b) => problemRank(a) - problemRank(b) || byName(a, b),
        cpu: byUsage('cpu'),
        memory: byUsage('mem'),
        name: byName,
        // Not running has no start time and sorts after every running one.
        'uptime-long': (a, b) => (a.startedAt || Infinity) - (b.startedAt || Infinity) || byName(a, b),
        'uptime-short': (a, b) => (b.startedAt || 0) - (a.startedAt || 0) || byName(a, b),
    };

    /** How long it has run, as short as a row has room for. */
    function uptime(dash, startedAt) {
        if (!startedAt) return '';
        const seconds = Math.max(0, Date.now() / 1000 - startedAt);
        if (seconds < 3600) {
            return label(dash, 'dashboard.widgetContainersMinutes', '{n} min')
                .replace('{n}', String(Math.max(1, Math.floor(seconds / 60))));
        }
        if (seconds < 86400) {
            return label(dash, 'dashboard.widgetContainersHours', '{n} h')
                .replace('{n}', String(Math.floor(seconds / 3600)));
        }
        return label(dash, 'dashboard.widgetContainersDays', '{n} d')
            .replace('{n}', String(Math.floor(seconds / 86400)));
    }

    /** The row's right-hand side: a problem when there is one, else the setting. */
    function detailFor(dash, c, mode) {
        const rank = problemRank(c);
        if (rank === 0) return [label(dash, 'dashboard.widgetContainersUnhealthy', 'unhealthy'), 'bad'];
        if (rank === 1) {
            return c.state === 'restarting'
                ? [label(dash, 'dashboard.widgetContainersRestarting', 'restarting'), 'bad']
                : [label(dash, 'dashboard.widgetContainersStopped', 'stopped'), 'warn'];
        }
        if (rank === 2) return [label(dash, 'dashboard.widgetContainersUpdate', 'update'), 'warn'];
        if (mode === 'none') return ['', ''];
        if (mode === 'tag') return [c.tag || '', ''];
        if (mode === 'usage') {
            // The stats sampler's last reading, as the Containers view shows it.
            if (!c.usage) return ['', ''];
            return [`${Number(c.usage.cpu).toFixed(1)} % · ${formatMem(c.usage.mem)}`, ''];
        }
        return [uptime(dash, c.startedAt), ''];
    }

    function openView(dash, select) {
        const opened = dash?.docker?.openDockerView?.(select ? { select } : undefined);
        if (opened && typeof opened.catch === 'function') opened.catch(() => {});
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const panel = u.panel(body);

        if (!data || !data.available) {
            u.say(panel, 'dashboard-widget-empty',
                S().unavailableText(dash, !data ? 'no-answer' : data?.reason || 'no-docker-socket'));
            return;
        }

        const config = widget?.config || {};
        const all = Array.isArray(data.containers) ? data.containers : [];
        const running = all.filter((c) => c.state === 'running').length;
        const list = (config.show === 'all' ? all : all.filter((c) => c.state === 'running'))
            .slice()
            .sort(SORTS[config.sort] || SORTS.problems);

        // The count stays small: the rows are the reading here, and the
        // containers widget is the one to add for the figure itself.
        const head = u.footnote(label(dash, 'dashboard.widgetContainersCaption', '{running} of {total} running')
            .replace('{running}', String(running))
            .replace('{total}', String(all.length)));
        head.classList.add('dashboard-widget-containers-count');
        panel.appendChild(head);

        if (!list.length) {
            u.say(panel, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetContainersNone', 'No containers are running.'));
            return;
        }

        const perColumn = u.rowLimit(widget, 6);
        const rows = u.rowList();
        list.slice(0, perColumn * 2).forEach((c, index) => {
            const [detail, tone] = detailFor(dash, c, config.detail);
            // [IP] filled in and only an http(s) page, as the table links it.
            const webui = window.DockerSearchIndex?.webuiHref(c.webui, c) || '';
            const toWebUI = config.click === 'webui' && webui;
            const item = u.row(c.name, detail, tone, () => {
                if (toWebUI) window.open(webui, '_blank', 'noopener');
                else openView(dash, c.name);
            }, {
                dash,
                labelKey: toWebUI ? 'widgetActionOpenWebUI' : 'widgetActionOpenContainer',
                labelFallback: toWebUI ? 'Open WebUI' : 'Open in Containers',
                // The other destination stays in the row's menu.
                href: webui || undefined,
            });
            item.dataset.containerName = c.name;
            if (index >= perColumn) item.classList.add('dashboard-widget-wide-only');
            rows.appendChild(item);
        });
        panel.appendChild(rows);

        // What did not fit, counted for the width the tile actually has.
        const openAll = () => openView(dash, null);
        const addMore = (hidden, widthClass) => {
            const holder = document.createElement('div');
            u.appendOverflowRow(holder, dash, hidden, openAll);
            const more = holder.firstElementChild;
            if (!more) return;
            more.classList.add(widthClass);
            rows.appendChild(more);
        };
        addMore(list.length - perColumn, 'dashboard-widget-narrow-only');
        addMore(list.length - perColumn * 2, 'dashboard-widget-wide-only');

        const age = u.asOf(dash, data._fetchedAt, { intervalMs: u.refreshMs(widget, dash) });
        if (age) panel.appendChild(age);
    }

    async function fetchContainers(dash, widget) {
        dash._widgetSystem = dash._widgetSystem || {};
        const key = `containers:${widget?.id || 'x'}`;
        if (dash._widgetSystem[key]) return dash._widgetSystem[key];
        try {
            const res = await fetch('/api/docker/containers');
            if (!res.ok) return null;
            const data = await res.json();
            if (data && typeof data === 'object') data._fetchedAt = Date.now();
            dash._widgetSystem[key] = data;
            return data;
        } catch (_error) {
            return null;
        }
    }

    async function render(body, widget, dash) {
        draw(body, widget, dash, await fetchContainers(dash, widget));
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.containers = render;
}());
