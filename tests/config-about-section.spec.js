// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * About is a section of the config rail, under Help.
 *
 * It was a ninth tab inside Help, which is where a reader goes to find out how
 * something works — not what this thing is, who wrote it, or where the release
 * notes are. Moving it out is only half the job: a section is a deep link, a
 * settings-jump target and a set of bound buttons, and the panels brought their
 * buttons with them.
 */

async function openConfig(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForTimeout(800);
}

test.describe('About in the rail', () => {
    test('sits last, after Help', async ({ page }) => {
        await openConfig(page, 'overview');
        const sections = await page.locator('[data-config-section]').evaluateAll((els) =>
            els.map((e) => e.getAttribute('data-config-section')));
        expect(sections[sections.length - 1]).toBe('about');
        expect(sections[sections.length - 2]).toBe('help');
    });

    test('Help no longer carries it as a tab', async ({ page }) => {
        await openConfig(page, 'help');
        const tabs = await page.locator('[data-help-tab]').evaluateAll((els) =>
            els.map((e) => e.getAttribute('data-help-tab')));
        expect(tabs.length).toBeGreaterThan(4);
        expect(tabs).not.toContain('about');
    });

    test('holds the wordmark and all three addresses', async ({ page }) => {
        await openConfig(page, 'about');
        await expect(page.locator('.help-about-mark img')).toBeVisible();
        for (const site of ['nextdash.cc', 'jordibrw.nl', 'github.com/jordibrouwer/nextDash']) {
            await expect(page.locator(`#config-section-panel a[href*="${site}"]`)).toHaveCount(1);
        }
    });
});

test.describe('a section is more than a panel', () => {
    test('#config/about opens it directly', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/about');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // Both the module and the loader that parses the hash before it arrives
        // have to know the name, or the link lands on Overview.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.section),
            { timeout: 15_000 }).toBe('about');
        await expect(page.locator('.help-about-mark')).toBeVisible();
    });

    test('its buttons are wired, not just rendered', async ({ page }) => {
        await openConfig(page, 'about');
        // The panels moved out of Help, where bindHelpActions ran; without it
        // here the button is present and does nothing.
        await page.locator('[data-help-action="whats-new"]').click();
        await expect(page.locator('.whats-new-modal')).toBeVisible({ timeout: 15_000 });
    });

    test('the settings jump points at the section, not at a tab that is gone', async ({ page }) => {
        await openConfig(page, 'overview');
        const entries = await page.evaluate(() =>
            window.dashboardInstance.config.buildSettingsJumpNavEntries()
                .filter((e) => e.section === 'about')
                .map((e) => ({ title: e.title, subTab: e.subTab })));

        expect(entries.length).toBeGreaterThanOrEqual(2);
        // A leftover subTab would try to open a help tab that no longer exists.
        expect(entries.every((e) => !e.subTab)).toBe(true);
        expect(entries.map((e) => e.title).join(' ')).toMatch(/About nextDash/);
    });
});
