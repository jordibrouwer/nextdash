// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The icon in front of a bookmark opens it, like the name does.
 *
 * The icon sat in the row's lead, next to the link rather than inside it, so a
 * click on it went nowhere. It is now an anchor of its own to the same address,
 * with the same target, and the grid's delegated listener treats it as the name.
 */

const rowSel = '#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link.reorder-item[data-bookmark-index]';

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page, {
        extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'],
    });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.waitForSelector(`${rowSel} .bookmark-icon-slot`, { timeout: 15_000 });
}

/** Keep every link click on the page, and remember where it would have gone. */
async function holdNavigation(page) {
    await page.addInitScript(() => {
        window.__linkClicks = [];
        document.addEventListener('click', (e) => {
            const link = e.target?.closest?.('a[href]');
            if (!link) return;
            window.__linkClicks.push({ href: link.href, target: link.target, defaultPrevented: e.defaultPrevented });
            e.preventDefault();
        });
    });
}

test.describe('the bookmark icon', () => {
    test('a click on it opens the bookmark, with the name\'s address and target', async ({ page }) => {
        await holdNavigation(page);
        const posted = [];
        await page.route('**/api/track-open', async (route) => {
            posted.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
        });
        await openDashboard(page);

        const row = page.locator(rowSel).first();
        const name = await row.locator('a.bookmark-open').evaluate((a) => ({ href: a.href, target: a.target }));
        await row.locator('.bookmark-icon-slot').click();

        const clicks = await page.evaluate(() => window.__linkClicks);
        expect(clicks).toHaveLength(1);
        expect(clicks[0].href).toBe(name.href);
        expect(clicks[0].target).toBe(name.target);
        expect(clicks[0].defaultPrevented).toBe(false);
        await expect.poll(() => posted.length).toBe(1);
        expect(posted[0].method).toBe('mouse');
    });

    test('a middle click on it counts as an open in a new tab', async ({ page }) => {
        const posted = [];
        await page.route('**/api/track-open', async (route) => {
            posted.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
        });
        await openDashboard(page);
        // The new tab itself is not under test; keep the browser from opening one.
        await page.evaluate(() => document.addEventListener('auxclick', (e) => e.preventDefault()));

        await page.locator(rowSel).first().locator('.bookmark-icon-slot').click({ button: 'middle' });
        await expect.poll(() => posted.length).toBe(1);
        expect(posted[0].method).toBe('mouse-middle');
    });

    test('Alt+click on it ticks the row, as on the name', async ({ page }) => {
        await openDashboard(page);
        await page.locator(rowSel).first().locator('.bookmark-icon-slot').click({ modifiers: ['Alt'] });
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBe(1);
    });

    test('it stays out of the tab order and out of the accessibility tree', async ({ page }) => {
        await openDashboard(page);
        const icon = page.locator(rowSel).first().locator('.bookmark-icon-slot');
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(icon).toHaveAttribute('tabindex', '-1');
        await expect(icon).toHaveJSProperty('draggable', false);

        // A press on it may focus it; the focus moves on to the name, so it
        // never rests on an element the accessibility tree does not have.
        await icon.focus();
        await expect.poll(() => page.evaluate(() => document.activeElement?.className || ''))
            .toContain('bookmark-open');

        // And after a real press, once the button is up.
        await page.evaluate(() => document.activeElement?.blur());
        await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault(), { once: true }));
        await icon.click();
        await expect.poll(() => page.evaluate(() => document.activeElement?.className || ''))
            .toContain('bookmark-open');
    });

    test('a long press on it opens the editor and does not open the bookmark', async ({ page }) => {
        // No holdNavigation here: its preventDefault would pass this test on its own.
        await openDashboard(page);
        const icon = page.locator(rowSel).first().locator('.bookmark-icon-slot');

        // A stationary press, dispatched the way the row drag spec does it: a
        // real mouse held on a desktop row is a reorder grab, and the press
        // that opens the editor is the touch one.
        await icon.evaluate((el) => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, composed: true,
                pointerId: 1, button: 0, isPrimary: true,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            }));
        });
        // The first long press also fetches the editor's module, so the time
        // it takes is not a fixed number.
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/, { timeout: 10_000 });

        // The release ends in a click on the icon, which must not open it.
        const opened = await icon.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        expect(opened).toBe(false);
    });

    test('a bookmark can still be dragged by its icon', async ({ page }) => {
        await openDashboard(page);
        // An onboarding-locked grid takes no pointer events, so no drag at all;
        // the same step the row drag spec takes.
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            if (d.settings.onboardingCompleted === true) return;
            d.settings.onboardingCompleted = true;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(d.settings),
            });
            window.GuidedFlowGuard?.sync?.();
        });
        const lists = await page.evaluate(() => Array.from(
            document.querySelectorAll('#dashboard-layout .bookmarks-list[data-category-id]'),
        ).filter((l) => l.getAttribute('data-smart-collection') !== 'true'
            && l.querySelector('.bookmark-link.reorder-item'))
            .slice(0, 2).map((l) => l.getAttribute('data-category-id')));
        test.skip(lists.length < 2, 'need two populated categories');
        const [srcCat, dstCat] = lists;
        const countIn = (cat) => page.evaluate((c) =>
            window.dashboardInstance.bookmarks.filter((b) => (b.category || '') === c).length, cat);
        const before = await countIn(srcCat);

        const src = page.locator(`.bookmarks-list[data-category-id="${srcCat}"] .bookmark-link.reorder-item`).first();
        const dst = page.locator(`.bookmarks-list[data-category-id="${dstCat}"] .bookmark-link.reorder-item`).first();
        const ib = await src.locator('.bookmark-icon-slot').boundingBox();
        const db = await dst.boundingBox();
        if (!ib || !db) throw new Error('missing boxes');

        await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
        await page.mouse.down();
        await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2 - 10, { steps: 4 });
        await page.mouse.move(db.x + db.width * 0.5, db.y + db.height / 2, { steps: 12 });
        await page.mouse.up();

        await expect.poll(() => countIn(srcCat)).toBe(before - 1);
    });
});
