// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A figure that moved says which way, and a figure that leads somewhere says
 * which key gets you there.
 *
 * The tile already carries a tone, quietens a nought and turns into a button
 * when it has somewhere to go. Two things it never said: whether the number
 * is better or worse than last time, and -- for the ones that are buttons --
 * that there is a key for it. The rest of the app prints its keys in the
 * label; a widget figure had no room for that, so the chip waits until the
 * reader is on the tile.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.DashboardWidgetUtils != null, null, { timeout: 20_000 });
}

/** Builds one stat grid off the shared builder and reports what it made. */
const build = (page, stats) => page.evaluate((cells) => {
    // `onOpen` is a function and cannot cross the evaluate boundary, so the
    // caller says whether there is a destination and it is made here.
    const prepared = cells.map((cell) => (
        cell.hasAction ? { ...cell, onOpen: () => {} } : cell
    ));
    const grid = window.DashboardWidgetUtils.statGrid(prepared);
    document.body.appendChild(grid);
    const read = [...grid.querySelectorAll('.dashboard-widget-stat')].map((cell) => ({
        tag: cell.tagName,
        className: cell.className,
        delta: cell.querySelector('.dashboard-widget-stat-delta')?.textContent ?? null,
        deltaClass: cell.querySelector('.dashboard-widget-stat-delta')?.className ?? null,
        key: cell.querySelector('.dashboard-widget-stat-key')?.textContent ?? null,
    }));
    grid.remove();
    return read;
}, stats);

test.describe('widget stat tiles', () => {
    test('a delta rides beside the value, toned by direction', async ({ page }) => {
        await openDashboard(page);

        const [better, worse, none] = await build(page, [
            { label: 'reachable', value: 79, delta: '+4', deltaTone: 'good' },
            { label: 'broken', value: 3, delta: '+1', deltaTone: 'bad' },
            { label: 'pages', value: 2 },
        ]);

        expect(better.delta).toBe('+4');
        expect(better.deltaClass).toContain('dashboard-widget-stat-delta--good');
        expect(worse.deltaClass).toContain('dashboard-widget-stat-delta--bad');

        // No delta means no element: an empty one reads as a figure that did
        // not move, which is a claim of its own.
        expect(none.delta, 'a figure with no delta still drew one').toBeNull();
    });

    test('a figure that leads somewhere prints its key', async ({ page }) => {
        await openDashboard(page);

        const [linked, plain, linkedNoKey] = await build(page, [
            { label: 'broken', value: 1, hasAction: true, key: '!' },
            { label: 'pages', value: 2, key: '!' },
            { label: 'stale', value: 9, hasAction: true },
        ]);

        expect(linked.tag, 'a figure with somewhere to go is not a button').toBe('BUTTON');
        expect(linked.key).toBe('!');

        // A key on a figure that goes nowhere would be a promise it cannot keep.
        expect(plain.key, 'a figure with no destination printed a key').toBeNull();
        expect(linkedNoKey.key, 'a key appeared out of nowhere').toBeNull();
    });
});
