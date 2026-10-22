// @ts-check
/*
 * The MANUAL.md screenshots that v1.21.0 changed, over the demo that nextDash
 * seeds itself (NEXTDASH_DEMO=1: public sites, three pages) rather than over
 * data-demo, which now holds personal links and keys.
 *
 *   NEXTDASH_DEMO=1 NEXTDASH_DATA_DIR=<empty dir> <server binary>   # once, then stop it
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<that dir> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-21.spec.js
 *
 * Same harness and the same Gloss Chrome dark look as manual-screenshots.spec.js.
 */
const {
    test,
    prepare,
    settle,
    shot,
    snap,
    openDashboard,
    DESKTOP,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.waitForTimeout(800);
    await settle(page);
}

async function openInbox(page) {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await page.locator('.inbox-layout').waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

async function openContainers(page) {
    await openDashboard(page);
    await page.locator('#page-nav-docker-host .docker-link-anchor').click();
    await page.locator('[data-docker-row]').first().waitFor();
    await settle(page);
    await page.waitForTimeout(800);
}

test('09 category menu', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.locator('.category-title', { hasText: /code/i }).first().click({ button: 'right' });
    const menu = page.locator('#category-context-menu');
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await snap(page, menu, '09-category-menu.jpg', { pad: 0, keepFocus: true });
});

test('13 inbox', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    await page.locator('.inbox-layout').getByText('Awesome self-hosted').first().click();
    await page.locator('[data-lvs-drawer-panel]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await shot(page, '13-inbox.jpg');
});

test('13 inbox row', async ({ page }) => {
    await prepare(page);
    await openInbox(page);
    const item = page.locator('.inbox-item', { hasText: 'Awesome self-hosted' }).first();
    await item.locator('.inbox-item-title').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await snap(page, [item, menu], '13-inbox-row.jpg', { pad: 4, keepFocus: true });
});

test('14 containers', async ({ page }) => {
    await prepare(page);
    await openContainers(page);
    await shot(page, '14-containers.jpg');
});

test('17 config', async ({ page }) => {
    await prepare(page);
    await openConfig(page);
    await page.waitForTimeout(1_000);
    await shot(page, '17-config.jpg');
});

test('17 find settings and only changed', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    const head = page.locator('.config-view > .config-view-head').first();
    const headBox = await head.boundingBox();
    await snap(page, head, '17-only-changed.jpg', { pad: 6, maxHeight: Math.floor(headBox.height) + 6 });
});
