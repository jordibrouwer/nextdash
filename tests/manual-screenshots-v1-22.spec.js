// @ts-check
/*
 * The MANUAL.md screenshots of chapter 16A, the new look, over the demo that
 * nextDash seeds itself (NEXTDASH_DEMO=1: public sites, three pages):
 *
 *   NEXTDASH_DEMO=1 NEXTDASH_DATA_DIR=<empty dir> <server binary>   # once, then stop it
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<that dir> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-22.spec.js
 *
 * Same harness as manual-screenshots.spec.js, in Aurora Glass dark.
 */
const fs = require('fs');
const path = require('path');
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

/** A change to this shot's copy of settings.json, written before the server starts. */
const withSettings = (change) => ({
    run(dir) {
        const file = path.join(dir, 'settings.json');
        const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify(change(settings), null, 2));
    },
});

const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await settle(page);
}

test.describe('the move to Aurora Glass', () => {
    // An install from before the new look: on another theme, the move not made yet.
    // The server makes it when it starts, and the dialog that explains it is waiting.
    test.use({
        shotTheme: 'matrix-bluepill-dark',
        dataTweak: withSettings((s) => {
            delete s.auroraGlassMigrated;
            delete s.lookMigration;
            return s;
        }),
    });
    test('16a migration dialog', async ({ page }) => {
        await prepare(page);
        await page.goto('/');
        const dialog = page.locator('#app-modal.show .modal').first();
        await dialog.waitFor({ state: 'visible', timeout: 30_000 });
        // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
        await page.waitForTimeout(1_200);
        await snap(page, dialog, '16a-migration-dialog.jpg', { pad: 16 });
    });
});

/** The same stretch of the dashboard: a category, the health tile and the Glances tile. */
async function frame(page, name) {
    await openDashboard(page);
    // Pacing for the capture, not a condition: the one-time tour is offered after a first visit and settle closes it.
    await page.waitForTimeout(1_500);
    const parts = [
        page.locator('#category-title-code').locator('xpath=ancestor::*[contains(@class,"category")][1]'),
        page.locator('[data-widget-type="health"]').first(),
        page.locator('[data-widget-type="glances"]').first(),
    ];
    await crop(page, parts, name, 14, 420);
}

test.describe('classic', () => {
    test.use({ dataTweak: withSettings((s) => ({ ...s, materialStyle: 'classic', themeSurfacesForceAll: true })) });
    test('16a classic', async ({ page }) => {
        await prepare(page);
        await frame(page, '16a-classic.jpg');
    });
});

test('16a signature', async ({ page }) => {
    await prepare(page);
    await frame(page, '16a-signature.jpg');
});

test('16a material style setting', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    await subtab(page, 'Surfaces').click();
    const panel = page.locator('#config-appearance-body .config-panel', { has: page.locator('[data-appearance-select="materialStyle"]') }).first();
    await panel.waitFor();
    await page.setViewportSize({ width: 1440, height: 1250 });
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(600);
    await snap(page, panel, '16a-material-style.jpg', { pad: 14, maxHeight: 380 });
});

test('16a backdrops', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
    await page.locator('[data-look-studio] [data-studio-tab="backdrop"], [data-look-studio] [role="tab"]', { hasText: /Backdrop/ }).first().click();
    // Pacing for the capture, not a condition: the studio tab finishes opening before the frame is taken.
    await page.waitForTimeout(800);
    const choose = page.locator('[data-look-studio]').getByText('Choose one', { exact: false }).first();
    if (await choose.count()) await choose.click();
    // Pacing for the capture, not a condition: the backdrop finishes drawing before the frame is taken.
    await page.waitForTimeout(1_500);
    await snap(page, page.locator('#look-studio-pane'), '16a-backdrops.jpg', { pad: 0, maxHeight: 760 });
});
