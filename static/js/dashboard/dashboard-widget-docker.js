/**
 * Containers: how many run, and what is quietly not.
 *
 * The headline is running against total, because the second number is what
 * makes the first mean anything: "12 running" cannot tell you something stopped
 * last night, and "12 of 17" can, since 17 was 17 yesterday too.
 *
 * Which figures appear is the reader's choice -- some people want stopped and
 * paused, others only care whether anything is unhealthy. Nothing stored means
 * all of them, so a figure added later is included by default rather than
 * hidden from everyone who ever saved these settings.
 *
 * At one column the chosen figures sit two abreast; given two they spread
 * across the width. The two lists -- what is unhealthy, what just restarted --
 * are separate toggles, because a name is not a figure: "one unhealthy" sends
 * you looking, and "one unhealthy: jellyfin" does not.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /* Every figure this tile can show, in the order they read best. */
    const FIGURES = [
        { key: 'running', field: 'running', text: ['dashboard.widgetDockerRunning', 'running'] },
        { key: 'stopped', field: 'stopped', text: ['dashboard.widgetDockerStopped', 'stopped'] },
        { key: 'paused', field: 'paused', text: ['dashboard.widgetDockerPaused', 'paused'] },
        { key: 'unhealthy', field: 'unhealthy', text: ['dashboard.widgetDockerUnhealthy', 'unhealthy'] },
        { key: 'total', field: 'total', text: ['dashboard.widgetDockerTotal', 'total'] },
        { key: 'images', field: 'images', text: ['dashboard.widgetDockerImages', 'images'] },
    ];

    /**
     * Tone by meaning, never by size.
     *
     * Nought unhealthy is the best news this tile can carry and still belongs
     * in the unhealthy cell; nought running on a machine with containers is
     * the worst, and looks identical without this.
     */
    function toneFor(key, value, docker) {
        if (key === 'unhealthy') return value > 0 ? 'bad' : undefined;
        if (key === 'stopped') return value > 0 ? 'warn' : undefined;
        if (key === 'running') return docker.total > 0 && value === 0 ? 'bad' : undefined;
        return undefined;
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const docker = data?.docker;

        if (!docker || !docker.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, docker?.reason || 'no-docker-socket'));
            return;
        }

        const config = widget?.config || {};
        // An absent list means all: see the note above.
        const chosen = Array.isArray(config.show) && config.show.length ? config.show : null;

        panel.appendChild(u.headline(
            String(docker.running),
            label(dash, 'dashboard.widgetDockerHeadline', 'of {total} running')
                .replace('{total}', String(docker.total)),
        ));

        if (docker.total > 0) {
            panel.appendChild(u.meter(docker.running, docker.total,
                docker.running < docker.total ? 'warn' : 'good'));
        }

        const stats = FIGURES
            .filter((f) => !chosen || chosen.includes(f.key))
            .map((f) => {
                const value = Number(docker[f.field]) || 0;
                return {
                    value: String(value),
                    label: label(dash, f.text[0], f.text[1]),
                    tone: toneFor(f.key, value, docker),
                };
            });
        if (stats.length) panel.appendChild(u.statGrid(stats));

        // The lists: each disk of a name rather than a count.
        const names = [];
        if (config.showUnhealthyNames && docker.unhealthyNames?.length) {
            names.push([
                label(dash, 'dashboard.widgetDockerUnhealthyList', 'failing'),
                docker.unhealthyNames.join(', '),
                'bad',
            ]);
        }
        if (config.showRestarted && docker.restartedNames?.length) {
            names.push([
                label(dash, 'dashboard.widgetDockerRestartedList', 'just restarted'),
                docker.restartedNames.join(', '),
                'warn',
            ]);
        }
        if (names.length) {
            const list = u.rowList(false);
            names.forEach(([name, detail, tone]) => list.appendChild(u.row(name, detail, tone)));
            panel.appendChild(list);
        }
    }

    async function render(body, widget, dash) {
        const data = await S().fetchMetrics(dash, 'docker', { cacheKey: `docker:${widget?.id || 'x'}` });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.docker = render;
}());
