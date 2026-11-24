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
// The way into the picker: the plus tile while there is room, else the footer button.
const ADD = `${PANEL} .quick-launch-tile--add, ${PANEL} .quick-launch-add`;

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
            quickLaunchAdded: [], quickLaunchHidden: [], quickLaunchSource: 'mix',
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
            // Fourteen addresses (a stale file or an old copy can hold more than the panel does):
            // the last two are past what it shows.
            const urls = window.__many.slice(0, 14).map((b) => b.url);
            d.settings.quickLaunchAdded = urls;
            const hidden = window.__many[13];
            const holdsHidden = ql.holds(hidden);
            const result = ql.toggleBookmark(hidden);
            d.settings.quickLaunchAdded = [...urls.slice(0, 11), 'https://gone.test/dead'];
            const added = ql.addBookmark(window.__many[16]);
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
        await page.locator(ADD).first().click();
        const search = page.locator(`${PANEL} .quick-launch-search`);
        await expect(search).toBeFocused();
        await search.fill(target.name.slice(0, 5));
        await page.locator(`${PANEL} .quick-launch-result`, { hasText: target.name }).first().click();
        await expect(page.locator(`${PANEL} .quick-launch-group[data-group="added"] .quick-launch-name`).first()).toHaveText(target.name);
        // The save is asynchronous: wait for the server to have it rather than asking once.
        const added = () => page.evaluate(async () => (await fetch('/api/settings').then((r) => r.json())).quickLaunchAdded || []);
        await expect.poll(added, { timeout: 8000 }).toContain(target.url);
        await page.locator(`${PANEL} .quick-launch-group[data-group="added"] .quick-launch-remove`).first().click();
        await expect(page.locator(`${PANEL} .quick-launch-group[data-group="added"]`)).toHaveCount(0);
        await expect.poll(added, { timeout: 8000 }).not.toContain(target.url);
    });

    test('Esc in the picker goes back to the panel, a second Esc closes it', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+Q');
        await page.locator(ADD).first().click();
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

    test('twelve is the ceiling, and the ones you add come first', async ({ page }) => {
        await loadDashboard(page);
        await addManyBookmarks(page);
        const list = await page.evaluate(() => {
            const d = window.dashboardInstance;
            window.__many.forEach((b, i) => { b.openCount = 100 - i; });
            d.settings.quickLaunchAdded = [window.__many[19].url];
            return window.QuickLaunch.list().map((e) => ({ group: e.group, name: e.bookmark.name }));
        });
        expect(list).toHaveLength(12);
        expect(list[0]).toEqual({ group: 'added', name: 'QL extra 19' });
    });

    test('adding to a full panel says which automatic tile made room', async ({ page }) => {
        await loadDashboard(page);
        await addManyBookmarks(page);
        const result = await page.evaluate(() => {
            const d = window.dashboardInstance;
            // Twelve automatic tiles: a pin and more than eleven opened ones.
            d.bookmarks[0].pinned = true;
            window.__many.slice(0, 14).forEach((b, i) => { b.openCount = 200 - i; });
            const full = window.QuickLaunch.list();
            const last = full[full.length - 1].bookmark;
            const target = window.__many[19];
            window.QuickLaunch.toggleBookmark(target);
            return { count: full.length, last: last.name, target: target.name, now: window.QuickLaunch.list().length };
        });
        expect(result.count).toBe(12);
        expect(result.now).toBe(12);
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

    test('Shift+Q before the other pages are loaded keeps the ones added from those pages', async ({ page }) => {
        await loadDashboard(page);
        const other = 'https://ql-other-page.test/';
        // Startup without a setting that needs other pages: allBookmarks not loaded yet.
        await page.evaluate((url) => {
            const d = window.dashboardInstance;
            d.settings.quickLaunchAdded = [url];
            d.allBookmarks = [];
            d._unsortedLoaded = false;
        }, other);
        await page.keyboard.press('ArrowDown');
        // Not the seeded pin: one that is not on the panel, so Shift+Q adds it.
        const selected = () => page.evaluate(() => {
            const b = window.dashboardInstance.keyboardNavigation.getSelectedBookmark();
            return { url: b?.url, held: window.QuickLaunch.holds(b) };
        });
        let pick = await selected();
        for (let i = 0; i < 30 && pick.held; i += 1) {
            await page.keyboard.press('ArrowDown');
            pick = await selected();
        }
        expect(pick.held).toBe(false);
        const row = pick.url;
        await page.keyboard.press('Shift+Q');
        const added = await page.evaluate(() => window.dashboardInstance.settings.quickLaunchAdded);
        expect(added).toContain(row);
        expect(added).toContain(other);
    });

    test("a bookmark's menu offers to add it to Quick launch", async ({ page }) => {
        await loadDashboard(page);
        const row = page.locator('#dashboard-layout .bookmark-open').first();
        const item = page.locator('.context-menu-item, [role="menuitem"]', { hasText: /Quick launch/ }).first();
        // The rows redraw once every page's bookmarks have arrived, so a right-click that lands
        // on a row about to be replaced opens nothing: once more, and only then. The menu itself
        // takes a moment to fill, so it is given time before the second try.
        const openMenu = async () => {
            await row.click({ button: 'right' });
            try {
                await expect(item).toBeVisible({ timeout: 6000 });
            } catch (error) {
                await page.keyboard.press('Escape');
                await row.click({ button: 'right' });
                await expect(item).toBeVisible({ timeout: 10_000 });
            }
        };
        await openMenu();
        const before = await item.textContent();
        await item.click();
        await openMenu();
        const after = await item.textContent();
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
        await page.locator(ADD).first().click();
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

    test('the panel takes its colours from the theme tokens, not from colours of its own', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+Q');
        await expect(page.locator(`${PANEL} .quick-launch-tile`).first()).toBeVisible();
        // What the theme's tokens resolve to, read through a probe the same way the tile reads them.
        const same = await page.evaluate(() => {
            const tile = document.querySelector('.modal.quick-launch-modal .quick-launch-tile');
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;visibility:hidden;border:1px solid var(--border-primary);color:var(--text-primary)';
            tile.parentElement.appendChild(probe);
            const want = getComputedStyle(probe);
            const got = getComputedStyle(tile);
            const out = { border: [got.borderTopColor, want.borderTopColor], text: [got.color, want.color] };
            probe.remove();
            return out;
        });
        expect(same.border[0]).toBe(same.border[1]);
        expect(same.text[0]).toBe(same.text[1]);
    });
});
