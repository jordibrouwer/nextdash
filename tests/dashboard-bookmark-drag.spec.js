// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    dismissBlockingOverlays,
    dismissOnboardingIfPresent,
} = require('./e2e-helpers');

const realCategorySel = '#dashboard-layout .category:not([data-smart-collection="true"])';
const rowSel = '.bookmark-link.reorder-item';

async function prepare(page) {
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector(realCategorySel, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Onboarding-locked grids set pointer-events:none, blocking native drag.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        if (d && d.settings && d.settings.onboardingCompleted !== true) {
            d.settings.onboardingCompleted = true;
            try {
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(d.settings),
                });
            } catch { /* best effort */ }
            window.GuidedFlowGuard?.sync?.();
        }
    });
}

/** Two real categories that each have at least one bookmark. */
async function twoPopulatedCategories(page) {
    return page.evaluate(() => {
        const lists = Array.from(
            document.querySelectorAll('#dashboard-layout .bookmarks-list[data-category-id]')
        ).filter((l) => l.getAttribute('data-smart-collection') !== 'true'
            && l.querySelector('.bookmark-link.reorder-item'));
        return lists.slice(0, 2).map((l) => l.getAttribute('data-category-id'));
    });
}

test.describe('dashboard bookmark drag', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await markWhatsNewSeen(page, {
            extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'],
        });
    });

    test('the whole row is the drag handle and the link is not draggable', async ({ page }) => {
        await prepare(page);
        const row = page.locator(`${realCategorySel} ${rowSel}`).first();
        await expect(row).toHaveJSProperty('draggable', true);
        // The inner <a> must NOT be draggable, or its native URL-drag hijacks reorder.
        const linkDraggable = await row.locator('.bookmark-open').evaluate((a) => a.draggable);
        expect(linkDraggable).toBe(false);
    });

    test('dragging a bookmark from the row body moves it to another category', async ({ page }) => {
        await prepare(page);
        const [srcCat, dstCat] = await twoPopulatedCategories(page);
        test.skip(!srcCat || !dstCat, 'need two populated categories');

        const before = await page.evaluate((cat) =>
            window.dashboardInstance.bookmarks.filter((b) => (b.category || '') === cat).length,
        srcCat);

        const src = page.locator(`.bookmarks-list[data-category-id="${srcCat}"] ${rowSel}`).first();
        const dst = page.locator(`.bookmarks-list[data-category-id="${dstCat}"] ${rowSel}`).first();
        const sb = await src.boundingBox();
        const db = await dst.boundingBox();
        if (!sb || !db) throw new Error('missing boxes');

        // Grab the row body (center), not the left grip strip.
        await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2 - 10, { steps: 4 });
        await page.mouse.move(db.x + db.width * 0.5, db.y + db.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(400);

        const afterSrc = await page.evaluate((cat) =>
            window.dashboardInstance.bookmarks.filter((b) => (b.category || '') === cat).length,
        srcCat);
        expect(afterSrc).toBe(before - 1);
    });

    test('holding over a target does not thrash the dragged row (no column flicker)', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await prepare(page);
        const [srcCat, dstCat] = await twoPopulatedCategories(page);
        test.skip(!srcCat || !dstCat, 'need two populated categories');

        const src = page.locator(`.bookmarks-list[data-category-id="${srcCat}"] ${rowSel}`).first();
        const dst = page.locator(`.bookmarks-list[data-category-id="${dstCat}"] ${rowSel}`).first();
        const sb = await src.boundingBox();
        const db = await dst.boundingBox();
        if (!sb || !db) throw new Error('missing boxes');

        // Count how often the dragged row itself is re-inserted into the DOM.
        await page.evaluate(() => {
            window.__draggedMoves = 0;
            const isDragged = (n) => n === (window.__dragReorderState && window.__dragReorderState.selected);
            const ib = Node.prototype.insertBefore;
            Node.prototype.insertBefore = function (n, r) { if (isDragged(n)) window.__draggedMoves++; return ib.call(this, n, r); };
            const ac = Node.prototype.appendChild;
            Node.prototype.appendChild = function (n) { if (isDragged(n)) window.__draggedMoves++; return ac.call(this, n); };
        });

        await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2 - 8, { steps: 3 });
        await page.mouse.move(db.x + db.width * 0.5, db.y + db.height / 2, { steps: 6 });
        await page.waitForTimeout(40);
        await page.evaluate(() => { window.__draggedMoves = 0; });
        // Hold still over the target; the relay must not re-home the dragged row.
        for (let i = 0; i < 20; i += 1) {
            await page.mouse.move(db.x + db.width * 0.5, db.y + db.height / 2);
            await page.waitForTimeout(15);
        }
        const moves = await page.evaluate(() => window.__draggedMoves);
        // The dragged row is display:none during the drag; only the placeholder moves.
        const hidden = await page.evaluate(() => {
            const d = window.__dragReorderState && window.__dragReorderState.selected;
            return d ? getComputedStyle(d).display === 'none' : false;
        });
        await page.mouse.up();
        expect(moves).toBe(0);
        expect(hidden).toBe(true);
    });

    test('a dragstart cancels the pending long-press so no editor opens mid-drag', async ({ page }) => {
        await prepare(page);
        const row = page.locator(`${realCategorySel} ${rowSel}`).first();
        await expect(row).toBeVisible();

        // Native HTML5 drag suppresses pointermove, so the slop check can't cancel
        // the timer — only the dragstart handler does. Simulate press-down then a
        // real dragstart, hold past the 500 ms threshold: the editor must stay shut.
        await row.evaluate((el) => {
            const target = el.querySelector('.bookmark-text') || el.querySelector('.bookmark-open') || el;
            const r = target.getBoundingClientRect();
            const p = {
                bubbles: true, cancelable: true, composed: true,
                pointerId: 1, button: 0, isPrimary: true,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            };
            target.dispatchEvent(new PointerEvent('pointerdown', p));
            // The browser fires dragstart once it decides the gesture is a drag.
            const dt = new DataTransfer();
            el.dispatchEvent(new DragEvent('dragstart', { ...p, dataTransfer: dt }));
        });
        await page.waitForTimeout(650); // past ROW_LONG_PRESS_MS (500)

        const editing = await page.evaluate(() =>
            Boolean(document.querySelector('.bookmark-link.bookmark-inline-editing'))
            || document.body.classList.contains('bookmark-inline-edit-active'));
        expect(editing).toBe(false);
    });

    test('a stationary long-press still opens the inline editor', async ({ page }) => {
        await prepare(page);
        const row = page.locator(`${realCategorySel} ${rowSel}`).first();
        await expect(row).toBeVisible();

        // Dispatch a real stationary pointerdown on the row body (not the grip) and
        // hold past ROW_LONG_PRESS_MS. Making the whole row draggable must not stop
        // the long-press editor from arming.
        await row.evaluate((el) => {
            const target = el.querySelector('.bookmark-text') || el.querySelector('.bookmark-open') || el;
            const r = target.getBoundingClientRect();
            const opts = {
                bubbles: true, cancelable: true, composed: true,
                pointerId: 1, button: 0, isPrimary: true,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            };
            target.dispatchEvent(new PointerEvent('pointerdown', opts));
        });
        await page.waitForTimeout(650); // past the 500 ms long-press threshold, no movement

        const editing = await page.evaluate(() =>
            Boolean(document.querySelector('.bookmark-link.bookmark-inline-editing'))
            || document.body.classList.contains('bookmark-inline-edit-active'));
        expect(editing).toBe(true);
    });

    test('a category sorted A–Z explains why bookmarks cannot be dragged', async ({ page }) => {
        await prepare(page);

        // Sort every populated real category A–Z, so at least one sort-active list with
        // a row is reliably present (avoids racing one specific category's re-render).
        const anyPopulated = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const lists = Array.from(
                document.querySelectorAll('#dashboard-layout .bookmarks-list[data-category-id]')
            ).filter((l) => l.getAttribute('data-smart-collection') !== 'true'
                && l.querySelector('.bookmark-link.reorder-item'));
            lists.forEach((l) => window.DashboardCategorySort
                .setCategorySortMode(d, l.getAttribute('data-category-id'), 'az'));
            // Force a full (non-incremental) render so the reorder init — which attaches
            // the sort-locked hint — runs deterministically.
            d.renderDashboard({ animate: true });
            return lists.length > 0;
        });
        test.skip(!anyPopulated, 'no populated category');

        // Everything else in one in-page step: wait for a sort-active list that has a
        // row and the hint title, then drive the pointer sequence (deterministic;
        // native mouse drag can hang headless).
        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const findReady = () => Array.from(
                document.querySelectorAll('#dashboard-layout .bookmarks-list.bookmarks-list--sort-active')
            ).find((l) => l.querySelector('.bookmark-link.reorder-item')
                && /manual order/i.test(l.getAttribute('title') || ''));

            let list = null;
            for (let i = 0; i < 120; i += 1) {
                list = findReady();
                if (list) break;
                await new Promise((r) => setTimeout(r, 50));
            }
            if (!list) return { notReady: true };

            const title = list.getAttribute('title') || '';
            const notifs = [];
            const orig = d.showNotification.bind(d);
            d.showNotification = (...a) => { notifs.push(a[0]); return orig(...a); };

            const row = list.querySelector('.bookmark-link.reorder-item');
            const r = row.getBoundingClientRect();
            const x = r.left + r.width * 0.6;
            const y = r.top + r.height / 2;
            const fire = (type, el, cx, cy) => el.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, composed: true,
                pointerId: 1, button: 0, isPrimary: true, clientX: cx, clientY: cy,
            }));

            fire('pointerdown', row, x, y);
            fire('pointerup', row, x, y);
            const afterClick = notifs.length;

            fire('pointerdown', row, x, y);
            fire('pointermove', list, x, y + 20);
            const afterDrag = notifs.length;
            fire('pointerup', list, x, y + 20);

            d.showNotification = orig;
            return { title, afterClick, afterDrag, first: notifs[0] || '' };
        });

        expect(result.notReady).not.toBe(true);
        expect(result.title).toMatch(/manual order/i);
        expect(result.afterClick).toBe(0);
        expect(result.afterDrag).toBeGreaterThan(0);
        expect(result.first).toMatch(/manual order/i);
    });
});
