/**
 * Glances, inside the Containers view.
 *
 * When Config → Glances says the Glances host is the same machine as the Docker
 * host (Auto, Yes or No; /api/glances/docker-link), a container's side panel gets
 * what nextDash recorded about it from Glances: processor, memory and network,
 * each over a range of its own up to thirty days, with the moments the container
 * restarted marked on them. If its history is not being recorded there is a
 * button to start. A button leads back to the container on the Glances page.
 *
 * Nothing is drawn, and nothing but the one answer about the link is asked,
 * when the two are not one machine or the container is not in Glances.
 */
(function () {
    'use strict';

    const { el } = window.DashboardGlancesDom;

    async function ensureModules() {
        const load = window.LazyScript?.loadScriptOnce;
        if (!load) return false;
        if (typeof window.DashboardGlances !== 'function') {
            await load('js/dashboard/dashboard-glances.js', 'dashboardGlancesModule',
                () => typeof window.DashboardGlances === 'function');
        }
        if (typeof window.DashboardGlancesChart === 'undefined') {
            await load('js/dashboard/dashboard-glances-chart.js', 'dashboardGlancesChart',
                () => typeof window.DashboardGlancesChart !== 'undefined');
        }
        return typeof window.DashboardGlancesChart !== 'undefined';
    }

    /** `host` is an empty element in the drawer; it stays hidden unless there is something to show. */
    async function mount(host, { dash, t, dockerName }) {
        if (!host || !dockerName || !dash?.glancesStatus?.configured) return;
        let link;
        try {
            const res = await fetch('/api/glances/docker-link', { credentials: 'same-origin' });
            link = res.ok ? await res.json() : null;
        } catch {
            link = null;
        }
        if (!link || !link.same) return;
        // Linked on purpose or by detection, yet nothing could be paired: say so here, where it is missed.
        if (link.problem && host.isConnected) {
            host.hidden = false;
            host.classList.add('glances-embed');
            host.setAttribute('data-glances-embed-problem', link.problem);
            host.replaceChildren(el('p', 'glances-embed-note', t('dashboard.glancesEmbedProblem', 'Linked to Glances, but no container could be paired. See Config → Glances → Advanced.')));
            return;
        }
        const match = (link.matches || []).find((m) => m.docker === dockerName);
        // The Docker host's own record, whichever host the page was last looking at.
        const Host = window.DashboardGlancesHost;
        const hostUrl = (address) => Host.url(address, link.hostId || '');
        if (!match || !host.isConnected) return;
        if (!(await ensureModules()) || !host.isConnected) return;

        const Chart = window.DashboardGlancesChart;
        const glancesName = match.glances;
        const key = `ct:${glancesName}`;
        const shim = { t: (k, f, p) => t(k, f, p), tipCard: null, dash };

        host.hidden = false;
        host.classList.add('glances-embed');
        host.setAttribute('data-glances-embed', glancesName);
        const head = el('div', 'glances-embed-head');
        head.appendChild(el('h4', 'glances-embed-title', t('dashboard.glancesEmbedTitle', 'From Glances')));
        const open = el('button', 'config-btn glances-embed-open', t('dashboard.glancesEmbedOpen', 'Open in Glances ↗'));
        open.type = 'button';
        open.setAttribute('data-glances-embed-open', '');
        open.addEventListener('click', () => {
            window.__glancesOpenContainer = glancesName;
            void dash.glances?.openGlancesView?.({ hash: `#glances/containers${link.hostId ? `?host=${encodeURIComponent(link.hostId)}` : ''}` });
        });
        head.appendChild(open);
        const body = el('div', 'glances-embed-body');
        host.replaceChildren(head, body);

        const DEFS = [
            { id: 'embed-cpu', label: ['dashboard.glancesChartCpu', 'Processor'], percent: true, suffixes: ['cpu'], bytes: false },
            { id: 'embed-mem', label: ['dashboard.glancesChartMem', 'Memory'], bytes: true, suffixes: ['mem'] },
            { id: 'embed-net', label: ['dashboard.glancesChartNetwork', 'Network'], rate: true, suffixes: ['rx', 'tx'] },
        ];

        let timer = null;
        let busy = false;
        const refresh = async () => {
            if (busy || !host.isConnected) return;
            busy = true;
            try {
                const results = await Promise.all(DEFS.map(async (def) => {
                    const names = def.suffixes.map((s) => `${key}:${s}`);
                    const since = Chart.sinceFor(def.id);
                    const res = await fetch(hostUrl(`/api/glances/history?series=${names.map(encodeURIComponent).join(',')}&since=${since}&restarts=${encodeURIComponent(dockerName)}`), { credentials: 'same-origin' });
                    return { def, answer: res.ok ? await res.json() : null };
                }));
                if (!host.isConnected) return;
                const any = results.some(({ answer }) => answer && answer.series && Object.keys(answer.series).length);
                if (!any) {
                    body.replaceChildren(notRecorded());
                    return;
                }
                const figures = results.map(({ def, answer }) => {
                    const view = {
                        id: def.id, label: def.label, percent: Boolean(def.percent), rate: Boolean(def.rate),
                        match: (n) => n.startsWith(`${key}:`) && def.suffixes.some((s) => n.endsWith(`:${s}`)),
                        name: (n) => n.slice(key.length + 1).replace('rx', '↓').replace('tx', '↑'),
                    };
                    if (def.bytes) view.bytes = true;
                    return Chart.panel(shim, view, answer, { height: 50, onRange: () => { void refresh(); } });
                });
                Chart.keepFocus(body, () => body.replaceChildren(...figures));
            } catch {
                /* the next beat tries again */
            } finally {
                busy = false;
            }
        };

        /** Nothing is recorded for this container yet: say so, and offer to start. */
        const notRecorded = () => {
            const box = el('div', 'glances-embed-empty');
            box.setAttribute('data-glances-embed-empty', '');
            box.appendChild(el('p', 'glances-note', t('dashboard.glancesEmbedNone',
                'Glances has not recorded this container yet. Recording reads the containers every few seconds, so it is switched on per container.')));
            const start = el('button', 'config-btn config-btn--primary', t('dashboard.glancesTrackStart', 'Record history'));
            start.type = 'button';
            start.setAttribute('data-glances-embed-record', '');
            start.addEventListener('click', async () => {
                start.disabled = true;
                try {
                    const current = await window.nextDashFetch(hostUrl('/api/glances/config'));
                    if (!current.ok) throw new Error(String(current.status));
                    const list = (await current.json()).trackedHistory || [];
                    const next = list.includes(key) ? list : [...list, key];
                    const saved = await window.nextDashFetch(hostUrl('/api/glances/config'), {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackedHistory: next }),
                    });
                    if (!saved.ok) throw new Error(String(saved.status));
                    box.replaceChildren(el('p', 'glances-note', t('dashboard.glancesEmbedStarted',
                        'Recording started. The graphs fill as it runs.')));
                } catch (err) {
                    start.disabled = false;
                    const full = String(err && err.message) === '400';
                    dash.showNotification?.(full
                        ? t('dashboard.glancesTrackFull', 'Too many items are recorded (at most 15). Stop recording another one first.')
                        : t('dashboard.glancesTrackFailed', 'Could not change the recording'), 'error');
                }
            });
            box.appendChild(start);
            return box;
        };

        await refresh();
        timer = setInterval(() => {
            if (!host.isConnected) {
                clearInterval(timer);
                return;
            }
            if (document.visibilityState === 'visible') void refresh();
        }, 30000);
    }

    window.DashboardGlancesEmbed = { mount };
}());
