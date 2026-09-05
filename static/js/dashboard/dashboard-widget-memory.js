/**
 * Memory: what is in use, and what is merely being kept warm.
 *
 * The server subtracts MemAvailable rather than MemFree, so "used" here is
 * memory the machine genuinely cannot hand out -- not page cache it would drop
 * the instant anything asked. Reporting the other figure is what makes a
 * perfectly healthy Linux box look permanently full, and is the reason people
 * go looking for a memory leak that is really just a working file cache.
 *
 * The cache is shown rather than hidden, because it is the other half of that
 * story: memory that is busy and instantly available at the same time.
 *
 * At one column the tile is the headline, a bar and two figures. Given two it
 * says more rather than saying the same thing larger: used, cache, free and
 * total sit abreast, and swap gets a line of its own -- swap creeping upwards
 * is the reading that actually predicts trouble.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /* Tone by how little room is left. Cache is not pressure, so it never counts. */
    function tone(usedPercent) {
        if (usedPercent >= 95) return 'bad';
        if (usedPercent >= 85) return 'warn';
        return 'good';
    }

    /** The four figures the tile breaks into once there is room for them. */
    function statsRow(dash, mem, showCache) {
        const s = S();
        const stats = [
            {
                value: s.formatBytes(mem.usedBytes),
                label: label(dash, 'dashboard.widgetMemoryUsedLabel', 'in use'),
                tone: tone(mem.usedPercent),
            },
            {
                value: s.formatBytes(mem.availableBytes),
                label: label(dash, 'dashboard.widgetMemoryAvailableLabel', 'available'),
            },
        ];
        if (showCache) {
            stats.push({
                value: s.formatBytes(mem.cacheBytes),
                label: label(dash, 'dashboard.widgetMemoryCacheLabel', 'cache'),
            });
        }
        stats.push({
            value: s.formatBytes(mem.totalBytes),
            label: label(dash, 'dashboard.widgetMemoryTotalLabel', 'total'),
        });
        return stats;
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const mem = data?.memory;

        if (!mem || !mem.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, mem?.reason || 'read-failed'));
            return;
        }

        const config = widget?.config || {};
        const showSwap = config.showSwap === true;
        const showCache = config.showCache === true;

        panel.appendChild(u.headline(
            `${Math.round(mem.usedPercent)}%`,
            label(dash, 'dashboard.widgetMemoryHeadline', '{used} of {total} in use')
                .replace('{used}', s.formatBytes(mem.usedBytes))
                .replace('{total}', s.formatBytes(mem.totalBytes)),
        ));

        panel.appendChild(u.meter(mem.usedBytes, mem.totalBytes, tone(mem.usedPercent)));

        // Four abreast on a wide tile, two on a narrow one: the stat grid
        // decides from the width it was actually drawn at.
        panel.appendChild(u.statGrid(statsRow(dash, mem, showCache)));

        if (showSwap) {
            const list = u.rowList(false);
            if (mem.hasSwap) {
                list.appendChild(u.row(
                    label(dash, 'dashboard.widgetMemorySwap', 'swap'),
                    label(dash, 'dashboard.widgetMemorySwapDetail', '{used} of {total}')
                        .replace('{used}', s.formatBytes(mem.swapUsedBytes))
                        .replace('{total}', s.formatBytes(mem.swapTotalBytes)),
                    // Swap in use is worth noticing long before it is full:
                    // a machine that has started swapping is already slowing.
                    mem.swapPercent >= 50 ? 'warn' : undefined,
                ));
                list.appendChild(u.meter(mem.swapUsedBytes, mem.swapTotalBytes,
                    mem.swapPercent >= 50 ? 'warn' : 'good'));
            } else {
                // Said plainly rather than drawn as nought of nought, which
                // reads as a full bar waiting to happen.
                list.appendChild(u.row(
                    label(dash, 'dashboard.widgetMemorySwap', 'swap'),
                    label(dash, 'dashboard.widgetMemoryNoSwap', 'none'),
                ));
            }
            panel.appendChild(list);
        }
    }

    async function render(body, widget, dash) {
        const data = await S().fetchMetrics(dash, 'memory', { cacheKey: `memory:${widget?.id || 'x'}` });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.memory = render;
}());
