/**
 * Disks: how full they are, and how much room is actually left.
 *
 * Named rather than enumerated: a container sees dozens of overlay and tmpfs
 * mounts, and a tile listing them all is noise. On Unraid the ones that matter
 * are /mnt/user and /mnt/cache; on a NAS, /volume1. Labels are what turn three
 * paths into "System / Media / Files".
 *
 * Free is what a reader may write, which is not what is left over from used:
 * reserved blocks belong to root, so they are neither. Keeping the three apart
 * is the difference between "594 GB free" and a figure gigabytes too generous.
 *
 * At one column the tile is the headline and a row per disk. Given two it says
 * more rather than saying the same thing larger: the totals break into four
 * figures across the top, and each disk's row gains what it is hiding at one
 * column -- used against total, and inodes when they are worth watching.
 *
 * A disk that cannot be read says so on its own row. An array with one drive
 * spun down is exactly the moment the other figures still matter.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /** Tone by how little is left, not by size: 90% of a big disk still bites. */
    function tone(usedPercent) {
        if (usedPercent >= 95) return 'bad';
        if (usedPercent >= 85) return 'warn';
        return 'good';
    }

    /** The four figures the totals break into once there is room for them. */
    function totalsRow(dash, disks) {
        const s = S();
        return [
            {
                value: s.formatBytes(disks.freeBytes),
                label: label(dash, 'dashboard.widgetDisksFreeLabel', 'free'),
                tone: tone(disks.usedPercent),
            },
            {
                value: s.formatBytes(disks.usedBytes),
                label: label(dash, 'dashboard.widgetDisksUsedLabel', 'used'),
            },
            {
                value: s.formatBytes(disks.totalBytes),
                label: label(dash, 'dashboard.widgetDisksTotalLabel', 'total'),
            },
            {
                value: `${Math.round(disks.usedPercent)}%`,
                label: label(dash, 'dashboard.widgetDisksFullLabel', 'full'),
            },
        ];
    }

    /** "594 GB free of 995 GB" — the second figure is what makes the first mean something. */
    function mountDetail(dash, mount) {
        const s = S();
        return label(dash, 'dashboard.widgetDisksFree', '{free} free of {total}')
            .replace('{free}', s.formatBytes(mount.freeBytes))
            .replace('{total}', s.formatBytes(mount.totalBytes));
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const disks = data?.disks;

        if (!disks || !disks.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, disks?.reason || 'no-mounts-configured'));
            return;
        }

        const config = widget?.config || {};
        const showMeter = config.showMeter !== false;
        const showInodes = config.showInodes === true;
        const mounts = disks.mounts || [];

        // The headline is the whole pool: one figure rather than a sum the
        // reader has to do across rows.
        panel.appendChild(u.headline(
            s.formatBytes(disks.freeBytes),
            label(dash, 'dashboard.widgetDisksHeadline', 'free of {total}')
                .replace('{total}', s.formatBytes(disks.totalBytes)),
        ));

        // Four abreast on a wide tile, two on a narrow one: the stat grid
        // decides from the width it was actually drawn at.
        panel.appendChild(u.statGrid(totalsRow(dash, disks)));

        /*
         * Not paired into two columns, unlike most row lists.
         *
         * A disk here is a group -- its name and figures, its bar, and its file
         * table -- and pairing splits those across columns, so a bar ends up
         * beside the disk above it. One file per disk keeps each group whole;
         * the width is spent on the totals row instead.
         */
        const list = u.rowList(false);
        mounts.forEach((mount) => {
            const name = mount.label || mount.path;

            if (mount.error) {
                list.appendChild(u.row(
                    name,
                    mount.error === 'refused'
                        ? label(dash, 'dashboard.widgetDisksRefused', 'not allowed')
                        : label(dash, 'dashboard.widgetDisksUnreadable', 'unreadable'),
                    'bad',
                ));
                return;
            }

            list.appendChild(u.row(name, mountDetail(dash, mount), tone(mount.usedPercent)));

            if (showMeter && mount.totalBytes > 0) {
                list.appendChild(u.meter(mount.usedBytes, mount.totalBytes, tone(mount.usedPercent)));
            }

            // Inodes run out on their own: a filesystem full of small files
            // refuses a write with gigabytes still showing free.
            if (showInodes && mount.inodesTotal > 0) {
                const usedInodes = mount.inodesTotal - mount.inodesFree;
                const pct = Math.round((usedInodes / mount.inodesTotal) * 100);
                list.appendChild(u.row(
                    label(dash, 'dashboard.widgetDisksInodes', 'files'),
                    `${pct}%`,
                    pct >= 90 ? 'warn' : undefined,
                ));
            }
        });
        panel.appendChild(list);

        if (disks.unreadable > 0) {
            panel.appendChild(u.footnote(
                label(dash, 'dashboard.widgetDisksSomeUnreadable', '{n} could not be read')
                    .replace('{n}', String(disks.unreadable)),
                'warn',
            ));
        }
    }

    async function render(body, widget, dash) {
        const config = widget?.config || {};
        const mounts = Array.isArray(config.mounts) ? config.mounts : [];
        // Labels travel as path=name pairs, so renaming a disk costs no second
        // request and the server never has to know what a label means.
        const labels = Array.isArray(config.labels) ? config.labels.join(',') : '';
        const data = await S().fetchMetrics(dash, 'disks', {
            mounts,
            labels,
            cacheKey: `disks:${widget?.id || 'x'}`,
        });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.disks = render;
}());
