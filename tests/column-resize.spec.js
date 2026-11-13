// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');
const { openInboxWith } = require('./helpers/inbox-report');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Column widths in the list views (Bookmarks, Inbox, Tags, Containers): drag a
 * heading's handle to the left and its column widens, Name gives way, the rows
 * follow the heading, the width survives a reload, and a double-click on the
 * handle puts the column back.
 */

const width = async (loc) => Math.round((await loc.boundingBox())?.width || 0);

/** Drag a handle with the real mouse; negative dx is left (wider). */
async function drag(page, handle, dx) {
    const b = await handle.boundingBox();
    if (!b) throw new Error('handle has no box');
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
}

/** The tracks a grid lays out, as numbers. */
const tracks = (loc) => loc.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').map((v) => Math.round(parseFloat(v))));

test.describe('column resize', () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1500, height: 950 }); });

    test('Bookmarks: the Tags handle widens the column, rows follow, a reload keeps it, a double-click resets it', async ({ page }) => {
        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        const head = page.locator('[data-bm-colhead]');
        const tagsHead = head.locator('.config-bm-colhead-tags');
        const handle = tagsHead.locator('.cr-handle');
        await expect(handle).toBeVisible();
        // Name is the column that gives way: it has no handle of its own.
        await expect(head.locator('.config-bm-colhead-name .cr-handle')).toHaveCount(0);

        const before = await width(tagsHead);
        await drag(page, handle, -40);
        const after = await width(tagsHead);
        expect(after).toBeGreaterThan(before + 25);

        const row = page.locator('#config-bm-list .config-bm-row').first();
        expect(await tracks(row)).toEqual(await tracks(head));

        await page.reload();
        await page.waitForSelector('#config-bm-workbench #config-bm-list .config-bm-row', { timeout: 15_000 });
        expect(await width(page.locator('[data-bm-colhead] .config-bm-colhead-tags'))).toBe(after);

        await page.locator('[data-bm-colhead] .config-bm-colhead-tags .cr-handle').dblclick();
        expect(await width(page.locator('[data-bm-colhead] .config-bm-colhead-tags'))).toBe(before);
    });

    test('Bookmarks: widening Tags shows more chips, narrowing folds them into +n', async ({ page }) => {
        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        const head = page.locator('[data-bm-colhead] .config-bm-colhead-tags');
        // Whole chips on show, and the +n that stands for the others, over every row.
        const shown = () => page.evaluate(() => [...document.querySelectorAll('#config-bm-list .config-bm-row')].map((row) => {
            const chips = [...row.querySelectorAll('.config-bm-tag:not(.config-bm-tag--more)')].filter((c) => !c.hidden).length;
            const more = row.querySelector('.config-bm-tag--more');
            const n = more && !more.hidden ? Number(more.textContent.replace(/\D/g, '')) : 0;
            return { chips, n };
        }));
        const sum = (rows) => rows.reduce((t, r) => t + r.chips, 0);
        const start = await shown();
        await drag(page, head.locator('.cr-handle'), -260);
        await expect.poll(async () => sum(await shown())).toBeGreaterThan(sum(start));
        const wide = await shown();
        // Same tags, shown or folded: chips + n never changes.
        expect(wide.map((r) => r.chips + r.n)).toEqual(start.map((r) => r.chips + r.n));
        await drag(page, head.locator('.cr-handle'), 400);
        await expect.poll(async () => sum(await shown())).toBeLessThan(sum(wide));
        const narrow = await shown();
        expect(narrow.map((r) => r.chips + r.n)).toEqual(start.map((r) => r.chips + r.n));
        expect(narrow.some((r) => r.n > 0)).toBe(true);
    });

    test('Bookmarks: a drag never sorts, and the arrow keys move a focused handle', async ({ page }) => {
        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        const head = page.locator('[data-bm-colhead]');
        const opensHead = head.locator('.config-bm-colhead-end', { hasText: /Opens/i });
        const handle = opensHead.locator('.cr-handle');
        const sortBefore = await page.locator('#config-bm-sort').inputValue();
        await drag(page, handle, -20);
        expect(await page.locator('#config-bm-sort').inputValue()).toBe(sortBefore);

        const w = await width(opensHead);
        await handle.focus();
        await page.keyboard.press('ArrowLeft');
        expect(await width(opensHead)).toBe(w + 16);
        await page.keyboard.press('ArrowRight');
        expect(await width(opensHead)).toBe(w);
    });

    test('Inbox: the Tags handle widens the column, heading and rows stay on one grid', async ({ page }) => {
        await openInboxWith(page);
        const head = page.locator('.inbox-colhead');
        const tagsHead = head.locator('.inbox-colhead-tags');
        await expect(head.locator('.inbox-colhead-title .cr-handle')).toHaveCount(0);
        const before = await width(tagsHead);
        await drag(page, tagsHead.locator('.cr-handle'), -50);
        expect(await width(tagsHead)).toBeGreaterThan(before + 30);

        const line = page.locator('.inbox-item .inbox-item-line1').first();
        const h = await tracks(head);
        const l = await tracks(line);
        // Rows carry their own inset; every track after the tick/icon pair matches.
        expect(l.slice(2)).toEqual(h.slice(2));

        await page.reload();
        await page.waitForSelector('.inbox-colhead', { timeout: 15_000 });
        expect(await width(page.locator('.inbox-colhead .inbox-colhead-tags'))).toBeGreaterThan(before + 30);
    });

    test('Tags view: the Opens handle widens the column and the rows follow', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.goto('/#tags');
        await page.reload();
        await page.waitForSelector('.tag-view-colhead', { timeout: 20_000 });

        const head = page.locator('.tag-view-colhead');
        const opens = head.locator('.tag-view-col--opens');
        await expect(head.locator('.tag-view-col--name .cr-handle')).toHaveCount(0);
        const before = await width(opens);
        await drag(page, opens.locator('.cr-handle'), -30);
        expect(await width(opens)).toBeGreaterThan(before + 15);

        const row = page.locator('.tag-view-row').first();
        expect(await tracks(row)).toEqual(await tracks(head));
    });

    test('Containers: the Status handle widens the column, Name gives way, a reload keeps it', async ({ page }) => {
        const row = (name) => ({ id: name.padEnd(64, '0'), shortId: name.padEnd(12, '0'), name, image: `x/${name}`, tag: 'latest',
            state: 'running', status: 'Up', health: '', created: 1790000000, ports: [] });
        const containers = ['alpha', 'bravo', 'charlie'].map(row);
        await mockDocker(page, { containers });
        await page.goto('/#docker');
        const nameHead = page.locator('.docker-table thead th.docker-head--name');
        const stateHead = page.locator('.docker-table thead th.docker-head--state');
        await expect(nameHead.locator('.cr-handle')).toHaveCount(0);

        const nameBefore = await width(nameHead);
        const stateBefore = await width(stateHead);
        await drag(page, stateHead.locator('.cr-handle'), -40);
        expect(await width(stateHead)).toBeGreaterThan(stateBefore + 25);
        expect(await width(nameHead)).toBeLessThan(nameBefore - 25);
        await expect(page.locator('.docker-table')).toHaveClass(/is-sized/);

        await page.reload();
        await expect(page.locator('.docker-table')).toHaveClass(/is-sized/);
        expect(await width(page.locator('.docker-table thead th.docker-head--state'))).toBeGreaterThan(stateBefore + 25);

        await page.locator('.docker-table thead th.docker-head--state .cr-handle').dblclick();
        // Every other column stays at the width it was frozen at; only this one is back to automatic.
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash.colwidths.docker') || '{}'));
        expect(stored.state).toBeUndefined();
    });

    test('a click on a handle changes nothing', async ({ page }) => {
        await openInboxWith(page);
        const tagsHead = page.locator('.inbox-colhead .inbox-colhead-tags');
        const before = await width(tagsHead);
        await tagsHead.locator('.cr-handle').click();
        expect(await width(tagsHead)).toBe(before);
        const stored = await page.evaluate(() => localStorage.getItem('nextdash.colwidths.inbox'));
        expect(stored).toBeNull();
    });
});
