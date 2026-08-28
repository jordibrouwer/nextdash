// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, waitForConfigReady } = require('./e2e-helpers');

/**
 * Help has to describe the app as it is now.
 *
 * Every release adds behaviour that only the person who built it knows about,
 * and Help is where someone else finds out — so a feature that ships without a
 * line here is a feature most people never meet. This pins the ones added since
 * v1.2.1: the shortcut modes, the cross-page duplicate question, coming back
 * where you were, Fresh, the review session, the Rot report, finding a setting
 * by its value, the capture routes, and what the server log says about itself.
 *
 * Matched on the rendered help text rather than on locale keys: what the reader
 * sees is the thing under test, and a key that renders nowhere passes a key
 * check.
 */

async function openHelp(page, tab) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForSelector('#config-help-body', { timeout: 15_000 });
    await page.evaluate((t) => {
        const c = window.dashboardInstance.config;
        c.helpTab = t;
        c.render();
    }, tab);
    await page.waitForTimeout(400);
    return page.locator('#config-help-body');
}

const CASES = [
    { tab: 'search', needles: [/typing a shortcut/i, /short pause/i] },
    { tab: 'organizing', needles: [/already saved this on/i, /come back where you were/i, /Fresh/] },
    { tab: 'health', needles: [/ten links, two minutes/i, /rot report/i] },
    { tab: 'config', needles: [/what it is set to/i, /all devices/i, /duplicate/i] },
    { tab: 'inbox', needles: [/integrations\//i, /share sheet/i] },
    // The log rebuild: a level and a component on every line, one control for
    // how much is written and another for what goes into the trail.
    { tab: 'data', needles: [/detail level/i, /activity trail/i, /docker logs/i] },
];

for (const { tab, needles } of CASES) {
    test(`help → ${tab} covers what was built`, async ({ page }) => {
        const body = await openHelp(page, tab);
        const text = await body.innerText();
        for (const needle of needles) {
            expect(text, `${tab} help is missing ${needle}`).toMatch(needle);
        }
    });
}

test('the Tips tab carries the new tips, in their groups', async ({ page }) => {
    const body = await openHelp(page, 'tips');
    const text = await body.innerText();
    // One per group that gained a tip, so a tip added to the locales but never
    // registered in ConfigHelpTips fails here rather than passing unseen.
    for (const needle of [/Shift\+F/, /share sheet/i, /Shift\+Alt/, /raccourci|shortcut/i, /two-minute session/i, /Fresh/, /Ctrl\+Shift\+K/]) {
        expect(text, `tips are missing ${needle}`).toMatch(needle);
    }
    // Every registered tip resolves to prose, rather than showing its own key.
    expect(text).not.toMatch(/tip[A-Z][A-Za-z]+/);
});

test('the cheat sheet lists the keys added since the last release', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.keyboard.press('!');
    const sheet = page.locator('#app-modal.show .keyboard-cheat-sheet-modal');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    // The groups are <details>; a collapsed one hides its rows from innerText.
    await sheet.evaluate((el) => el.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const text = await sheet.innerText();
    // The modal draws each key as a chip, so the registry's "Shift + F" reads
    // as "Shift+F" on screen — assert what a reader sees.
    expect(text).toContain('Shift+F');
    expect(text).toContain('Shift+Alt');
    expect(text).toMatch(/Filter the page you are on in place/);
    expect(text).toMatch(/category beside it/);
});
