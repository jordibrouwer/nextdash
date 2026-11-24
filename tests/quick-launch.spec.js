// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Quick launch: a panel in the middle of the screen with the bookmarks you put
 * there, the ones you pinned and the ones you open most. A corner element,
 * Shift+Q and a mouse drawn in circles open it; + in the panel, Shift+Q on a
 * bookmark and the bookmark's menu put one in or take it out.
 *
 * The page's bookmarks are seeded in memory (a pin, a few open counts) so the
 * order of the panel is known; the lists Quick launch keeps are real settings.
 */

const PANEL = '.modal.quick-launch-modal';

async function loadDashboard(page, width = 1400) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.QuickLaunch, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.loadAllBookmarks?.();
        Object.assign(d.settings, {
            quickLaunchAdded: [], quickLaunchHidden: [], quickLaunchSource: 'mix', quickLaunchCount: 8,
            quickLaunchButton: true, quickLaunchGesture: true, quickLaunchTurns: 1.5, quickLaunchAutoClose: 5,
        });
        await d.saveSettings();
        d.bookmarks.forEach((b) => { b.pinned = false; b.openCount = 0; });
        const [a, b, c, e, f] = d.bookmarks;
        a.pinned = true;
        b.openCount = 9;
        c.openCount = 5;
        e.openCount = 2;
        f.openCount = 1;
        window.QuickLaunch.sync();
    });
}

/** A page of the dashboard may hold few bookmarks: add as many as a test needs, none of them touched by the seeding. */
async function addManyBookmarks(page, n = 20) {
    await page.evaluate((count) => {
        const d = window.dashboardInstance;
        window.__many = Array.from({ length: count }, (_, i) => ({
            name: `QL extra ${i}`, url: `https://ql-extra-${i}.test/`, pageId: d.currentPageId, category: '', icon: '', openCount: 0,
        }));
        d.bookmarks.push(...window.__many);
    }, n);
}

const names = (page, group) => page.locator(`${PANEL} .quick-launch-group[data-group="${group}"] .quick-launch-name`).allTextContents();

test.describe('Quick launch', () => {
    test('Shift+Q opens the panel, pinned first and then the most opened, and closes it again', async ({ page }) => {
        await loadDashboard(page);
        const seeded = await page.evaluate(() => window.dashboardInstance.bookmarks.slice(0, 3).map((b) => b.name));
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeVisible();
        expect(await names(page, 'pinned')).toEqual([seeded[0]]);
        expect((await names(page, 'top'))[0]).toBe(seeded[1]);
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeHidden();
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(PANEL)).toBeHidden();
    });

    test('the corner element shows on a computer and is gone below 992 px', async ({ page }) => {
        await loadDashboard(page);
        const corner = page.locator('#quick-launch-button');
        await expect(corner).toBeVisible();
        const box = await corner.boundingBox();
        expect(box.x + box.width).toBeGreaterThan(1380);
        expect(box.y).toBeLessThan(2);
        await corner.click();
        await expect(page.locator(PANEL)).toBeVisible();
        await expect(corner).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(corner).toHaveAttribute('aria-expanded', 'false');
        await page.setViewportSize({ width: 900, height: 900 });
        await expect(corner).toBeHidden();
        // The key still works where there is a keyboard.
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeVisible();
    });

    test('the corner button setting hides the element and leaves the key working', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchButton = false; window.QuickLaunch.sync(); });
        await expect(page.locator('#quick-launch-button')).toBeHidden();
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeVisible();
    });

    test('drawing circles opens it and a shake does not', async ({ page }) => {
        await loadDashboard(page);
        const circle = async (from, to) => {
            for (let i = from; i < to; i += 1) {
                await page.mouse.move(700 + 80 * Math.cos(i * 0.35), 500 + 80 * Math.sin(i * 0.35));
            }
        };
        // A shake across the page: reversals, not turning.
        for (let i = 0; i < 60; i += 1) await page.mouse.move(600 + (i % 2 ? 60 : -60), 500);
        await expect(page.locator(PANEL)).toBeHidden();
        await circle(0, 40);
        await expect(page.locator(PANEL)).toBeVisible();
    });

    test('the gesture follows the circles setting and can be switched off', async ({ page }) => {
        await loadDashboard(page);
        const circle = async (from, to) => {
            for (let i = from; i < to; i += 1) {
                await page.mouse.move(700 + 80 * Math.cos(i * 0.35), 500 + 80 * Math.sin(i * 0.35));
            }
        };
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchGesture = false; });
        await circle(0, 40);
        await expect(page.locator(PANEL)).toBeHidden();
        // Three circles is 54 steps of 0.35 rad: 30 steps is not enough, 70 is.
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchGesture = true; window.dashboardInstance.settings.quickLaunchTurns = 3; });
        await circle(0, 30);
        await expect(page.locator(PANEL)).toBeHidden();
        await circle(30, 80);
        await expect(page.locator(PANEL)).toBeVisible();
    });

    test('a digit opens that tile once', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeVisible();
        const clicks = await page.evaluate(() => new Promise((resolve) => {
            let n = 0;
            let opened = 0;
            window.open = () => { opened += 1; return null; };
            document.querySelectorAll('.modal.quick-launch-modal .quick-launch-tile').forEach((tile) => {
                tile.addEventListener('click', (e) => { n += 1; e.preventDefault(); });
            });
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true }));
            setTimeout(() => resolve({ n, opened }), 200);
        }));
        expect(clicks).toEqual({ n: 1, opened: 0 });
    });

    test('a hand-added bookmark stays removable after the count is lowered, and a dead address does not block +', async ({ page }) => {
        await loadDashboard(page);
        await addManyBookmarks(page);
        const out = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const ql = window.QuickLaunch;
            const urls = window.__many.slice(0, 8).map((b) => b.url);
            d.settings.quickLaunchAdded = urls;
            d.settings.quickLaunchCount = 4;
            const hidden = window.__many[7];
            const holdsHidden = ql.holds(hidden);
            const result = ql.toggleBookmark(hidden);
            d.settings.quickLaunchCount = 8;
            d.settings.quickLaunchAdded = [...urls.slice(0, 7), 'https://gone.test/dead'];
            const added = ql.addBookmark(window.__many[10]);
            return { holdsHidden, result, added, now: d.settings.quickLaunchAdded.includes('https://gone.test/dead') };
        });
        expect(out).toEqual({ holdsHidden: true, result: 'removed', added: true, now: false });
    });

    test('Shift+Q twice on an automatic tile hides it and then puts it back', async ({ page }) => {
        await loadDashboard(page);
        const out = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const ql = window.QuickLaunch;
            const b = d.bookmarks[1];
            const first = ql.toggleBookmark(b);
            const second = ql.toggleBookmark(b);
            return { first, second, hidden: d.settings.quickLaunchHidden.includes(b.url), added: d.settings.quickLaunchAdded.includes(b.url) };
        });
        expect(out).toEqual({ first: 'removed', second: 'added', hidden: false, added: false });
    });

    test('+ finds a bookmark by name and puts it first; the cross takes it out again', async ({ page, request }) => {
        await loadDashboard(page);
        const target = await page.evaluate(() => {
            const d = window.dashboardInstance;
            // One the seeding did not touch: the last on the page.
            const b = d.bookmarks[d.bookmarks.length - 1];
            return { name: b.name, url: b.url };
        });
        await page.keyboard.press('Shift+Q');
        await page.locator(`${PANEL} .quick-launch-add`).click();
        const search = page.locator(`${PANEL} .quick-launch-search`);
        await expect(search).toBeFocused();
        await search.fill(target.name.slice(0, 5));
        await page.locator(`${PANEL} .quick-launch-result`, { hasText: target.name }).first().click();
        await expect(page.locator(`${PANEL} .quick-launch-group[data-group="added"] .quick-launch-name`).first()).toHaveText(target.name);
        const saved = await page.evaluate(async () => (await fetch('/api/settings').then((r) => r.json())).quickLaunchAdded);
        expect(saved).toContain(target.url);
        await page.locator(`${PANEL} .quick-launch-group[data-group="added"] .quick-launch-remove`).first().click();
        await expect(page.locator(`${PANEL} .quick-launch-group[data-group="added"]`)).toHaveCount(0);
        const after = await page.evaluate(async () => (await fetch('/api/settings').then((r) => r.json())).quickLaunchAdded);
        expect(after).not.toContain(target.url);
    });

    test('Esc in the picker goes back to the panel, a second Esc closes it', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+Q');
        await page.locator(`${PANEL} .quick-launch-add`).click();
        await expect(page.locator(`${PANEL} .quick-launch-search`)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(`${PANEL} .quick-launch-search`)).toHaveCount(0);
        await expect(page.locator(PANEL)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(PANEL)).toBeHidden();
    });

    test('the cross on an automatic tile hides it, and Show hidden brings it back', async ({ page }) => {
        await loadDashboard(page);
        const top = await page.evaluate(() => window.dashboardInstance.bookmarks[1].name);
        await page.keyboard.press('Shift+Q');
        await page.locator(`${PANEL} .quick-launch-tile`, { hasText: top }).first().hover();
        await page.locator(`${PANEL} .quick-launch-cell`, { hasText: top }).first().locator('.quick-launch-remove').click();
        expect(await names(page, 'top')).not.toContain(top);
        await page.locator(`${PANEL} .quick-launch-unhide`).click();
        expect(await names(page, 'top')).toContain(top);
    });

    test('the number of bookmarks is a ceiling, and the ones you add come first', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchCount = 4; });
        const list = await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.quickLaunchAdded = [d.bookmarks[d.bookmarks.length - 1].url];
            return window.QuickLaunch.list().map((e) => ({ group: e.group, name: e.bookmark.name }));
        });
        expect(list).toHaveLength(4);
        expect(list[0].group).toBe('added');
    });

    test('adding to a full panel says which automatic tile made room', async ({ page }) => {
        await loadDashboard(page);
        await addManyBookmarks(page);
        const result = await page.evaluate(() => {
            const d = window.dashboardInstance;
            // Eight automatic tiles: a pin and seven opened ones.
            d.bookmarks.slice(1, 8).forEach((b, i) => { b.openCount = 10 - i; });
            const full = window.QuickLaunch.list();
            const last = full[full.length - 1].bookmark;
            const target = window.__many[19];
            window.QuickLaunch.toggleBookmark(target);
            return { count: full.length, last: last.name, target: target.name, now: window.QuickLaunch.list().length };
        });
        expect(result.count).toBe(8);
        expect(result.now).toBe(8);
        await expect(page.locator('body')).toContainText(`pushed out: ${result.last}`);
    });

    test('Shift+Q on a bookmark adds or removes that bookmark and does not open the panel', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('ArrowDown');
        const row = await page.evaluate(() => {
            const b = window.dashboardInstance.keyboardNavigation.getSelectedBookmark();
            return { url: b.url, held: window.QuickLaunch.holds(b) };
        });
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(PANEL)).toBeHidden();
        const now = await page.evaluate((url) => window.QuickLaunch.list().some((e) => e.bookmark.url === url), row.url);
        expect(now).toBe(!row.held);
        await page.keyboard.press('Shift+Q');
        const back = await page.evaluate((url) => window.QuickLaunch.list().some((e) => e.bookmark.url === url), row.url);
        expect(back).toBe(row.held);
    });

    test("a bookmark's menu offers to add it to Quick launch", async ({ page }) => {
        await loadDashboard(page);
        const row = page.locator('#dashboard-layout .bookmark-open').first();
        await row.click({ button: 'right' });
        const item = page.locator('.context-menu-item, [role="menuitem"]', { hasText: /Quick launch/ }).first();
        await expect(item).toBeVisible();
        const before = await item.textContent();
        await item.click();
        await row.click({ button: 'right' });
        const after = await page.locator('.context-menu-item, [role="menuitem"]', { hasText: /Quick launch/ }).first().textContent();
        expect(after).not.toBe(before);
        expect(/Add to Quick launch/.test(before) !== /Add to Quick launch/.test(after)).toBe(true);
    });

    test('the panel closes itself when the pointer stays outside, and not while it is inside or a key is used', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchAutoClose = 3; });
        await page.keyboard.press('Shift+Q');
        const panel = page.locator(PANEL);
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        // The mouse where the key left it never starts the clock; inside the panel it stops it.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(3600);
        await expect(panel).toBeVisible();
        // Outside: it closes after three seconds.
        await page.mouse.move(30, 450);
        await page.mouse.move(40, 460);
        await page.waitForTimeout(1500);
        await expect(panel).toBeVisible();
        await page.waitForTimeout(2200);
        await expect(panel).toBeHidden();
        // A key press while outside gives the reader the time back.
        await page.keyboard.press('Shift+Q');
        await expect(panel).toBeVisible();
        await page.mouse.move(30, 450);
        await page.mouse.move(40, 460);
        await page.waitForTimeout(2000);
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(2500);
        await expect(panel).toBeVisible();
    });

    test('never closes by itself with the delay set to never, and not while the picker is open', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchAutoClose = 0; });
        await page.keyboard.press('Shift+Q');
        await page.mouse.move(30, 450);
        await page.mouse.move(40, 460);
        await page.waitForTimeout(3600);
        await expect(page.locator(PANEL)).toBeVisible();
        await page.evaluate(() => { window.dashboardInstance.settings.quickLaunchAutoClose = 3; });
        await page.locator(`${PANEL} .quick-launch-add`).click();
        await page.mouse.move(30, 450);
        await page.mouse.move(40, 460);
        await page.waitForTimeout(3600);
        await expect(page.locator(`${PANEL} .quick-launch-search`)).toBeVisible();
    });

    test('K opens the related links and B puts a label above, for the bookmark under the cursor', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('ArrowDown');
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            window.__keys = [];
            d.related = d.related || {};
            d.related.openMenu = async (bookmark) => { window.__keys.push('related ' + bookmark.url); };
            window.DashboardCategoryDividers.slotAbove = () => ({ categoryId: 'c1', index: 2 });
            window.DashboardCategoryDividers.add = (dash, categoryId, index) => { window.__keys.push(`label ${categoryId} ${index}`); };
        });
        await page.keyboard.press('k');
        await page.keyboard.press('b');
        const keys = await page.evaluate(() => window.__keys);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toMatch(/^related https?:/);
        expect(keys[1]).toBe('label c1 2');
        // And the menu says so.
        await page.keyboard.press('Escape');
        await page.locator('#dashboard-layout .bookmark-open').first().click({ button: 'right' });
        const menu = page.locator('.context-menu, [role="menu"]').first();
        await expect(menu.locator('text=Related links').locator('..')).toContainText('K');
    });

    test('the circle recognizer: circles in both directions count, shakes, lines and wobbles do not', async ({ page }) => {
        await loadDashboard(page);
        const results = await page.evaluate(() => {
            const run = (fn, turns = 1.5) => {
                const r = window.QuickLaunchCore.createRecognizer({ turns });
                let best = 0;
                let t = 0;
                for (let i = 0; i < 160; i += 1) { t += 16; best = Math.max(best, r.feed(...fn(i), t)); }
                return best;
            };
            return {
                clockwise: run((i) => [300 + 80 * Math.cos(i * 0.25), 300 + 80 * Math.sin(i * 0.25)]),
                anticlockwise: run((i) => [300 + 80 * Math.cos(-i * 0.25), 300 + 80 * Math.sin(-i * 0.25)]),
                shake: run((i) => [300 + (i % 2 ? 60 : -60), 300]),
                line: run((i) => [100 + i * 10, 300]),
                zigzag: run((i) => [100 + i * 10, 300 + (i % 2 ? 30 : -30)]),
                wobble: run((i) => [300 + 10 * Math.cos(i * 0.4), 300 + 10 * Math.sin(i * 0.4)]),
                moreTurns: run((i) => [300 + 80 * Math.cos(i * 0.25), 300 + 80 * Math.sin(i * 0.25)], 3),
            };
        });
        expect(results.clockwise).toBe(1);
        expect(results.anticlockwise).toBe(1);
        expect(results.shake).toBe(0);
        expect(results.line).toBe(0);
        expect(results.zigzag).toBe(0);
        expect(results.wobble).toBe(0);
        expect(results.moreTurns).toBe(1);
    });

    test('the panel takes the surface of the theme: no colour of its own', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+Q');
        const tile = page.locator(`${PANEL} .quick-launch-tile`).first();
        await expect(tile).toBeVisible();
        const read = () => page.evaluate(() => {
            const el = document.querySelector('.modal.quick-launch-modal .quick-launch-tile');
            const cs = getComputedStyle(el);
            return { bg: cs.backgroundColor, border: cs.borderTopColor, panel: getComputedStyle(document.querySelector('.modal.quick-launch-modal')).backgroundColor };
        });
        const first = await read();
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            document.documentElement.style.setProperty('--background-secondary', 'rgb(1, 2, 3)');
            document.body.style.setProperty('--background-secondary', 'rgb(1, 2, 3)');
            document.body.style.setProperty('--border-primary', 'rgb(9, 8, 7)');
        });
        await page.keyboard.press('Shift+Q');
        await expect(tile).toBeVisible();
        const second = await read();
        expect(second.border).toBe('rgb(9, 8, 7)');
        expect(second.bg).not.toBe(first.bg);
    });
});
