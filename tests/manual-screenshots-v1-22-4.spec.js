// @ts-check
/*
 * The MANUAL.md screenshots of the v1.22.4 features -- edit mode, the search
 * panel's "Usually now" and result actions, the checkup and the weekly digest
 * window -- over the demo that nextDash seeds itself (scripts/make-manual-seed.sh):
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-22-4.spec.js
 *
 * Same harness as manual-screenshots.spec.js.
 */
const {
    test,
    prepare,
    settle,
    shot,
    snap,
    crop,
    openDashboard,
    DESKTOP,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

// A stored category: the first blocks on the page are collections (Today, Fresh), which have no panel of their own.
const firstCategory = (page) => page.locator('#dashboard-layout .category[data-category-id="code"] .category-title').first();

test.describe('edit mode', () => {
    test('04 edit mode: a category chosen', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('Shift+M');
        await page.locator('body[data-edit-mode="on"]').waitFor();
        await firstCategory(page).click();
        await page.locator('#edit-mode-panel [data-edit-section="category"]').waitFor();
        await settle(page);
        await page.waitForTimeout(600);
        await shot(page, '04-edit-mode.jpg');
    });

    test('04 edit mode: a widget sheet over the dashboard', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('Shift+M');
        await page.locator('body[data-edit-mode="on"]').waitFor();
        await page.locator('#dashboard-layout .dashboard-widget .dashboard-widget-title, #dashboard-layout .dashboard-widget .category-title').first().click();
        await page.locator('#edit-mode-panel [data-edit-section="widget"]').waitFor();
        await page.locator('#edit-mode-panel [data-edit-action="widget-settings"], #edit-mode-panel button', { hasText: /Settings/ }).first().click();
        await page.locator('.config-widget-sheet').waitFor();
        await page.waitForTimeout(800);
        await crop(page, page.locator('.config-widget-sheet'), '04-edit-mode-widget-sheet.jpg', 24);
    });
});

test.describe('search', () => {
    test('08 search: usually now', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // The group is worked out from the time of day the panel opens at: a weekday morning, when the seed's rhythm has its opens.
        await page.clock.setFixedTime(new Date('2026-10-27T10:30:00'));
        await page.keyboard.press('>');
        await page.locator('#shortcut-search .search-container').waitFor();
        await page.waitForTimeout(900);
        await crop(page, page.locator('#shortcut-search .search-container'), '08-search-usually-now.jpg');
    });

    test('08 search: the actions of a result', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.clock.setFixedTime(new Date('2026-10-27T10:30:00'));
        await page.keyboard.press('>');
        await page.locator('#shortcut-search .search-container').waitFor();
        await page.waitForTimeout(900);
        // Down to the first bookmark row (the "Usually now" group), then Right unfolds its actions.
        for (let i = 0; i < 12; i += 1) {
            const type = await page.evaluate(() => {
                const s = window.dashboardInstance.searchComponent;
                return s.selectableMatches[s.selectedMatchIndex]?.type;
            });
            if (type === 'bookmark') break;
            await page.keyboard.press('ArrowDown');
        }
        await page.keyboard.press('ArrowRight');
        await page.locator('.search-row-actions').first().waitFor();
        await page.waitForTimeout(500);
        await crop(page, page.locator('#shortcut-search .search-container'), '08-search-actions.jpg');
    });
});

test.describe('tidying up', () => {
    test('12 checkup', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press(':');
        await page.keyboard.type('checkup');
        await page.keyboard.press('Enter');
        await page.locator('.checkup-modal, [data-checkup], .checkup').first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(900);
        await crop(page, page.locator('#app-modal.show, .modal.show').first(), '12-checkup.jpg', 24);
    });
});

test.describe('weekly digest', () => {
    test('12 weekly digest window', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // A proof digest from the seed's data, the way Config -> Monitoring -> Notifications -> Send does it.
        const res = await page.request.post('/api/digest/test');
        test.skip(res.status() === 204, 'the seed has nothing to put in a digest');
        await page.keyboard.press(':');
        await page.keyboard.type('digest');
        await page.keyboard.press('Enter');
        await page.locator('.digest-modal .digest-window').waitFor({ timeout: 15_000 });
        await page.waitForTimeout(1_200);
        await crop(page, page.locator('.modal.digest-modal'), '12-weekly-digest.jpg', 24);
    });
});
