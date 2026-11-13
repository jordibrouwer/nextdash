// @ts-check
/*
 * The MANUAL.md screenshots of the phone layout (v1.29.0): the two start
 * screens, the search sheet, Status, More, the short bookmark menu and the
 * Inbox. Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-29.spec.js
 */
const { test, prepare, shot, openDashboard, PHONE } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);
test.use({ viewport: PHONE, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

const tab = (page, id) => page.locator(`#mobile-tabbar [data-tab="${id}"]`);

async function phoneDashboard(page) {
    await prepare(page);
    await openDashboard(page);
    await page.locator('#mobile-tabbar').waitFor();
}

test.describe('the phone layout', () => {
    test('23 start screen, search first', async ({ page }) => {
        await phoneDashboard(page);
        await page.locator('#mobile-home .mobile-search--big').waitFor();
        await shot(page, '23-phone-home-search.jpg');
    });

    test('23 start screen, status first', async ({ page }) => {
        await phoneDashboard(page);
        await tab(page, 'more').click();
        await page.locator('#mobile-panel [data-home="status"]').click();
        await tab(page, 'home').click();
        await page.locator('#mobile-home[data-variant="status"]').waitFor();
        await shot(page, '23-phone-home-status.jpg');
    });

    test('23 the search sheet', async ({ page }) => {
        await phoneDashboard(page);
        await tab(page, 'search').click();
        const field = page.locator('input[type="search"], input[type="text"]').filter({ visible: true }).last();
        await field.waitFor();
        await field.fill('doc');
        // Pacing for the capture, not a condition: the results draw.
        await page.waitForTimeout(800);
        await shot(page, '23-phone-search.jpg');
    });

    test('23 the Status screen', async ({ page }) => {
        await phoneDashboard(page);
        await tab(page, 'status').click();
        await page.locator('#mobile-panel [data-status-row]').first().waitFor();
        await shot(page, '23-phone-status.jpg');
    });

    test('23 the More screen', async ({ page }) => {
        await phoneDashboard(page);
        await tab(page, 'more').click();
        await page.locator('#mobile-panel').getByText('Quick settings').waitFor();
        await shot(page, '23-phone-more.jpg');
    });

    test('23 the short bookmark menu', async ({ page }) => {
        await phoneDashboard(page);
        const row = page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])').first();
        await row.scrollIntoViewIfNeeded();
        // A real long press: pointer down, hold, no move.
        await row.evaluate((el) => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.x + 40, clientY: r.y + r.height / 2, button: 0 }));
        });
        await page.locator('#bookmark-context-menu').first().waitFor({ state: 'visible', timeout: 4000 });
        await shot(page, '23-phone-menu.jpg');
    });

    test('23 the Inbox', async ({ page }) => {
        await phoneDashboard(page);
        await tab(page, 'inbox').click();
        await page.locator('.inbox-item').first().waitFor();
        await shot(page, '23-phone-inbox.jpg');
    });
});
