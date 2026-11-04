// @ts-check
/*
 * nextdash.cc feature-page loops (loop.webm), batch LB: dashboard, finders,
 * glances, languages. Silent 1440x900 recordings in Tarnished Brass dark.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=1 \
 *     npx playwright test tests/site-loops-LB.spec.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { test, prepare, settle, openDashboard, DESKTOP, OUT } = require('./helpers/manual-shot-kit');
const { mockGlances } = require('./helpers/glances-mock');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce', video: { mode: 'on', size: { width: 1440, height: 900 } } });
test.setTimeout(120_000);

const TRIM = '/private/tmp/claude-501/agents/trim-loop.sh';
/** A pause between two steps of the interaction, so a viewer can follow it. */
// Pacing for the capture, not a condition: the loop plays at human pace.
const rest = (page, ms) => page.waitForTimeout(ms);

/** Closes the page, then cuts the recording from startAt to now into <OUT>/<slug>/loop.webm. */
async function finishLoop(page, slug, t0, startAt) {
    const seconds = (Date.now() - t0) / 1000 - startAt;
    await page.close();
    const video = await page.video().path();
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'loop.json'), JSON.stringify({ startAt, video, seconds }));
    expect(seconds).toBeGreaterThanOrEqual(8);
    expect(seconds).toBeLessThanOrEqual(13);
    execFileSync(TRIM, [video, String(startAt), String(Math.min(seconds, 12.9)), path.join(dir, 'loop.webm')]);
}

const now = (t0) => (Date.now() - t0) / 1000;

test('loop dashboard: page 2, week overview, back to page 1', async ({ page }) => {
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page);
    await page.mouse.move(5, 895);
    const startAt = now(t0);
    await rest(page, 1_500);
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/#2$/);
    await rest(page, 2_000);
    await page.locator('.date-time-line').first().click();
    await page.locator('#date-popover').waitFor({ state: 'visible' });
    await rest(page, 2_500);
    await page.keyboard.press('Escape');
    await page.locator('#date-popover').waitFor({ state: 'hidden' });
    await rest(page, 700);
    await page.keyboard.press('1');
    await rest(page, 2_500);
    await finishLoop(page, 'dashboard', t0, startAt);
});

test('loop finders: ? du nextdash', async ({ page }) => {
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page);
    await page.mouse.move(5, 895);
    const startAt = now(t0);
    await rest(page, 1_500);
    await page.keyboard.press('?');
    await page.locator('#shortcut-search .search-container').waitFor();
    await rest(page, 2_000);
    await page.keyboard.type('du nextdash', { delay: 180 });
    await rest(page, 2_500);
    await page.keyboard.press('Escape');
    await page.locator('#shortcut-search .search-container').waitFor({ state: 'hidden' });
    await rest(page, 1_800);
    await finishLoop(page, 'finders', t0, startAt);
});

test('loop glances: overview, history, processes', async ({ page }) => {
    const t0 = Date.now();
    await prepare(page);
    await mockGlances(page);
    await openDashboard(page);
    // First visit: let the tour play out and close before the loop starts.
    await page.locator('#page-nav-glances-link').click();
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    await rest(page, 1_500);
    await settle(page);
    await page.keyboard.press('Escape');
    await page.locator('#dashboard-layout.glances-layout').waitFor({ state: 'detached' });
    await openDashboard(page);
    await page.mouse.move(5, 895);
    const startAt = now(t0);
    await rest(page, 1_500);
    await page.keyboard.press('Shift+G');
    await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
    await page.locator('[data-glances-block="figures"]').waitFor();
    await rest(page, 2_200);
    await page.keyboard.press('h');
    await page.locator('[data-glances-incident]').first().waitFor();
    await rest(page, 2_300);
    await page.keyboard.press('p');
    await page.locator('[data-glances-pid]').first().waitFor();
    await rest(page, 2_000);
    await page.keyboard.press('Escape');
    await page.locator('#dashboard-layout.glances-layout').waitFor({ state: 'detached' });
    await page.locator('.category').first().waitFor();
    await rest(page, 1_800);
    await finishLoop(page, 'glances', t0, startAt);
});

test('loop languages: English, Dutch, Chinese, English', async ({ page }) => {
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="behavior"]').click();
    await page.locator('.config-subtab', { hasText: 'General' }).first().click();
    const select = page.locator('[data-behavior-field="language"]').first();
    await select.waitFor();
    await select.scrollIntoViewIfNeeded();
    await settle(page);
    await page.mouse.move(5, 895);
    const startAt = now(t0);
    await rest(page, 1_800);
    await select.selectOption('nl');
    await page.waitForFunction(() => window.dashboardInstance.language.currentLanguage === 'nl', null, { timeout: 40_000 });
    await rest(page, 2_600);
    await page.locator('[data-behavior-field="language"]').first().selectOption('zh');
    await page.waitForFunction(() => window.dashboardInstance.language.currentLanguage === 'zh', null, { timeout: 40_000 });
    await rest(page, 2_600);
    await page.locator('[data-behavior-field="language"]').first().selectOption('en');
    await page.waitForFunction(() => window.dashboardInstance.language.currentLanguage === 'en', null, { timeout: 40_000 });
    // The corner "Saved" note leaves before the loop ends, so the last frame is the first.
    await page.locator('.is-saved').first().waitFor({ state: 'attached', timeout: 15_000 });
    await expect(page.locator('.is-saved')).toHaveCount(0, { timeout: 15_000 });
    await rest(page, 1_500);
    await finishLoop(page, 'languages', t0, startAt);
});
