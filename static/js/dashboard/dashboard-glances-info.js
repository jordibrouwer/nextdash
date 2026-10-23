/**
 * Glances page: the ℹ buttons.
 *
 * Four levels, from the whole page to one word:
 *   - the page: an ℹ in the header's actions (where the Bookmarks, Inbox and
 *     Containers views keep theirs) opens "How the Glances page works";
 *   - a block or a graph: an ℹ beside its title opens a small popover of two or
 *     three sentences;
 *   - a setting: the same ℹ beside "Record every" and the connection switch;
 *   - a term: only where a word is cryptic (the health score, "when full", the
 *     "Yesterday" line).
 *
 * A button is only made where there is text behind it. Every string is the
 * English the locale files translate, and reaches the page through textContent.
 */
(function () {
    'use strict';

    /** id -> [title, body]. The title only shows in the popover. */
    const TEXTS = {
        // blocks on the Overview
        system: ['Machine', 'The host\'s name, operating system, kernel, uptime and processor, as Glances reports them.'],
        figures: ['Right now', 'Processor, memory, swap and load from the last read. The line behind each is the last minute, taken from nextDash\'s own record, so it stays short or empty when recording is slow.'],
        cores: ['Processor per core', 'The load of every core now, with the last minute behind it. One core staying high while the rest idle usually means a single-threaded task is busy.'],
        temps: ['Temperatures', 'Every sensor Glances finds, grouped by name. Yellow and red follow the limits a sensor reports itself, or the lines you set in Config → Glances.'],
        network: ['Network', 'Speed in and out per interface. Virtual ones (Docker, bridges, bonds) are left out so the same traffic is not counted twice.'],
        diskio: ['Disk activity', 'What each disk reads and writes per second. The graph under it is the recorded history.'],
        disks: ['Disks', 'Mounts grouped by role: array, cache and pools, system. Under a bar: the free space, an estimate of when the disk is full, drawn from nextDash\'s own record (it needs about half a day), and what the disk is doing now.'],
        smart: ['Disk health', 'What the drives report about themselves (SMART). A warning here is worth looking at before the disk fails.'],
        processes: ['Busiest processes', 'The processes using the most processor now. Click one for its side panel; its history is only recorded when you switch that on there.'],
        containers: ['Containers', 'The containers Glances sees, with status, processor and memory. A ↗ opens the same container in the Containers view when nextDash manages that Docker host.'],
        alerts: ['Alerts', 'The alerts Glances has raised, ongoing and recent.'],
        // graphs
        'chart-cpu': ['Processor history', 'The processor load over the range you pick. Red bands are moments it went past its red line.'],
        'chart-memory': ['Memory history', 'RAM and swap use over the range you pick.'],
        'chart-memparts': ['Memory parts', 'What the memory is made of: programs at the bottom, cache that can be given back above it, free on top. The three always make a hundred.'],
        'chart-load': ['Load history', 'The system load over 1, 5 and 15 minutes. Compare it with the number of cores: a load above that count means work is waiting.'],
        'chart-network': ['Network history', 'Traffic per interface, up and down, over the range you pick.'],
        'chart-diskio': ['Disk activity history', 'Reads and writes per second for each disk over the range you pick.'],
        'chart-disks': ['Disk usage history', 'How full each mount was over the range you pick. A line that only climbs is a disk that is filling.'],
        'chart-temps': ['Temperature history', 'The hottest sensors over the range you pick.'],
        // Insights
        health: ['Health', 'A single number for how the machine is doing, and what holds it back. Everything here is worked out by nextDash from its own record; none of it comes from Glances.'],
        stats: ['Typical and peak', 'Average, median and the 95th and 99th percentile over the range. The 95th is the level it stayed under 95% of the time, so it shows the busy end without one-off spikes. A note says when this hour is higher or lower than usual.'],
        heatmap: ['Busy hours', 'One square per hour of each day: darker is busier. It shows the rhythm of the week, such as a nightly backup. Empty squares are hours nothing was recorded.'],
        volume: ['Network per day', 'How much went over the network each day, down and up, from the recorded speeds. Needs a day or more of record.'],
        availability: ['Availability', 'How often the host answered when nextDash asked. Each block is a quarter of an hour.'],
        incidents: ['Incidents', 'Moments a reading went past its red line: processor, memory, swap, a disk, a temperature, or the host not answering. Kept for thirty days.'],
        consumers: ['Who used the most', 'The processes and containers whose history you switched on, ranked by how much processor they used over the range.'],
        compare: ['Compared with before', 'The average of each reading over the range you picked, set against the same length of time right before it (the day before, the week before). Needs twice the range of record, so a 24-hour range shows after two days.'],
        day: ['A typical day', 'The average for each hour of the day over the range: one bar per hour, midnight on the left. It shows when the machine is busy or quiet, such as a nightly backup or the evening. Each row has its own scale, and the figure on the right is its highest hour.'],
        spikes: ['Peaks and rhythm', 'The busiest and quietest hour of the day, and the moments a reading rose far above its usual level (more than three standard deviations over the average, and half as much again). Spikes close together count as one. The busiest process or container is named when its history is recorded.'],
        load: ['Load and cores', 'Load is how many tasks want the processor at once. As long as it stays under the number of cores, nothing waits. The bars show each core\'s average with its peak as a tick; one core far above the rest points to a single-threaded task.'],
        memory: ['Memory and swap', 'Where the memory goes on average: programs in use, cache that is given back when asked, and free. Swap in use for hours means the machine ran short of memory. The table ranks the processes and containers whose history is recorded.'],
        sensors: ['Temperature per sensor', 'Every sensor nextDash records, hottest first. "Over yellow" is the time it spent above the yellow line you set in Config → Glances.'],
        filesystems: ['Disk space over time', 'How full the fullest disks are now and how much that moved over the range, in percentage points. For a prediction of when a disk is full, see Health.'],
        insdisk: ['Disk activity', 'What each disk read and wrote per second over the range: the average, the highest second, and the hour of the day it was busiest.'],
        interfaces: ['Network per interface', 'What each network interface carried over the range, from the recorded speeds, and the containers with the most traffic. Virtual interfaces are left out.'],
        // settings
        record: ['Record every', 'How often nextDash reads the host to build the history, whether or not this page is open. Longer asks the host less but fills the record slowly and leaves short graphs sparse. From 5 minutes up, one reading over a red line already counts as an incident.'],
        connection: ['Connection', 'Off: nextDash reads nothing from the host. The page and the recorded history stay, and switching it on again resumes. It is the same switch as in Config → Glances.'],
        // terms
        score: ['Health score', 'A score out of 100: how close each reading is to its red line, ongoing incidents, and how often the host answered. 85 and up is good, 60 and up fair.'],
        forecast: ['When a disk is full', 'A straight line through the last week of each disk\'s use. It is only shown with about half a day of record, and a disk that is not growing says steady.'],
        yesterday: ['Yesterday', 'Draws the same graph from a day earlier as a dashed line, moved forward a day, so you can see whether now is unusual. Only for ranges of a day or less.'],
    };

    let open = null;

    function closePopover() {
        if (!open) return;
        open.pop.remove();
        open.button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', open.outside, true);
        window.removeEventListener('keydown', open.keys, true);
        window.removeEventListener('resize', open.close);
        window.removeEventListener('scroll', open.close, true);
        const { button, focus } = open;
        open = null;
        if (focus) button.focus({ preventScroll: true });
    }

    function place(pop, button) {
        const rect = button.getBoundingClientRect();
        const width = Math.min(pop.offsetWidth || 288, window.innerWidth - 16);
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        pop.style.left = `${left}px`;
        pop.style.top = `${rect.bottom + 6}px`;
        const bottom = rect.bottom + 6 + pop.offsetHeight;
        if (bottom > window.innerHeight - 8 && rect.top - 6 - pop.offsetHeight > 8) {
            pop.style.top = `${rect.top - 6 - pop.offsetHeight}px`;
        }
    }

    function openPopover(view, button, id) {
        if (open && open.button === button) {
            closePopover();
            return;
        }
        closePopover();
        const [titleFallback, bodyFallback] = TEXTS[id];
        const pop = document.createElement('div');
        pop.className = 'glances-info-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('data-glances-info-pop', id);
        pop.tabIndex = -1;
        const title = document.createElement('strong');
        title.className = 'glances-info-pop-title';
        title.id = `glances-info-title-${id}`;
        pop.setAttribute('aria-labelledby', title.id);
        title.textContent = view.t(`dashboard.glancesInfoTitle_${id.replace(/-/g, '_')}`, titleFallback);
        const body = document.createElement('p');
        body.className = 'glances-info-pop-body';
        body.textContent = view.t(`dashboard.glancesInfo_${id.replace(/-/g, '_')}`, bodyFallback);
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'glances-info-pop-more';
        more.textContent = view.t('dashboard.glancesInfoMore', 'How this page works');
        more.addEventListener('click', () => {
            closePopover();
            explainer(view);
        });
        pop.append(title, body, more);
        document.body.appendChild(pop);
        place(pop, button);
        button.setAttribute('aria-expanded', 'true');
        const state = {
            pop,
            button,
            focus: false,
            close: () => closePopover(),
            outside: (e) => {
                if (pop.contains(e.target) || button.contains(e.target)) return;
                closePopover();
            },
            keys: (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    state.focus = true;
                    closePopover();
                    return;
                }
                if (e.key !== 'Tab') return;
                // The popover holds the focus: Tab walks its one control, and leaving it
                // closes it and goes on from the button that opened it.
                const inside = pop.contains(document.activeElement);
                if (!inside) return;
                const last = e.shiftKey ? document.activeElement === pop : document.activeElement === more;
                if (!last) return;
                e.preventDefault();
                state.focus = true;
                closePopover();
            },
        };
        open = state;
        // Keyboard and pointer alike: the popover takes the focus, so reading it and
        // reaching its link does not mean tabbing through the rest of the page.
        pop.focus({ preventScroll: true });
        document.addEventListener('pointerdown', state.outside, true);
        window.addEventListener('keydown', state.keys, true);
        window.addEventListener('resize', state.close);
        window.addEventListener('scroll', state.close, true);
    }

    /** An ℹ for one id, or null when there is no text for it. */
    function button(view, id) {
        if (!TEXTS[id]) return null;
        const label = view.t(`dashboard.glancesInfoTitle_${id.replace(/-/g, '_')}`, TEXTS[id][0]);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'glances-info-btn';
        btn.setAttribute('data-glances-info', id);
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        const aria = view.t('dashboard.glancesInfoAria', 'About {name}', { name: label });
        btn.setAttribute('aria-label', aria);
        btn.title = aria;
        btn.textContent = 'ℹ';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPopover(view, btn, id);
        });
        return btn;
    }

    /** "How the Glances page works", the same stepped sheet the other views have. */
    function explainer(view) {
        if (typeof window.AppModal?.show !== 'function') return;
        window.nextdashTrack?.('glances:explainer');
        const esc = (v) => view.dash.escapeHtml(String(v));
        const row = (key, title, body) => `<div class="view-explain-row"><h4>${esc(view.t(`dashboard.glancesHelp${key}Title`, title))}</h4><p>${esc(view.t(`dashboard.glancesHelp${key}`, body))}</p></div>`;
        window.AppModal.show({
            title: view.t('dashboard.glancesHelpTitle', 'How the Glances page works'),
            htmlMessage: `<div class="view-explain">
                ${row('What', 'One machine', 'The Glances page shows one host as Glances 4 sees it, and keeps its own record of it. nextDash only reads from Glances; it never changes anything there. The address and the thresholds are in Config → Glances.')}
                ${row('Sections', 'The sections', 'Overview is the whole machine at a glance. Processes, Containers, Disks and Network are the tables behind it. Insights is what nextDash works out itself. History is the graphs. Alerts are the ones Glances raised. o, p, c, d, n, i, h and a jump between them.')}
                ${row('Record', 'The record', 'nextDash reads the host on its own pace, set by Record every at the top, and keeps thirty days: on the server, whether or not this page is open. A process or container only gets a history of its own when you switch that on in its side panel, because reading them costs the host.')}
                ${row('Graphs', 'The graphs', 'Each graph has its own range, from a minute to thirty days, and a Yesterday line to lay the same window of a day earlier behind it. Red bands are moments something went past its red line.')}
                ${row('Connection', 'The connection switch', 'Off stops every read from the host. The page and the record stay, and the same switch in Config → Glances turns it on again.')}
                ${row('Data', 'Your data', 'Collected data, a CSV download and a button to delete it are in Config → Glances. Nothing leaves your server.')}
            </div>`,
            confirmText: view.t('dashboard.healthExplainClose', 'Got it'),
            showCancel: false,
            modalClass: 'view-explain-modal',
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
        });
    }

    /** The header's ℹ, in the actions row like the other views'. */
    function helpButton(view) {
        const help = document.createElement('button');
        help.type = 'button';
        help.className = 'lvs-action view-help-btn';
        help.setAttribute('data-glances-help', '');
        help.setAttribute('aria-haspopup', 'dialog');
        const label = view.t('dashboard.glancesHelpTitle', 'How the Glances page works');
        help.title = label;
        help.setAttribute('aria-label', label);
        help.textContent = 'ℹ';
        help.addEventListener('click', () => explainer(view));
        return help;
    }

    window.DashboardGlancesInfo = { TEXTS, button, helpButton, explainer, close: closePopover };
}());
