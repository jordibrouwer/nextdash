// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The right-hand rail shares every rule with the left one — the selectors match
 * a side-agnostic [data-rail] hook and direction comes from variables. So the
 * thing worth testing is that the mirror actually holds, and that nothing is
 * pushed off-screen on the side the rail no longer occupies.
 */

async function setPosition(page, position) {
    await page.evaluate(async (p) => {
        const d = window.dashboardInstance;
        d.settings.buttonBarPosition = p;
        d.setupDOM?.();
        await d.saveSettings?.();
    }, position);
}

async function railMetrics(page) {
    return page.evaluate(() => {
        const bar = document.querySelector('.button-container');
        const rect = bar.getBoundingClientRect();
        const barStyle = getComputedStyle(bar);
        const container = document.querySelector('.container');
        const containerStyle = container ? getComputedStyle(container) : null;
        return {
            rail: document.body.getAttribute('data-rail'),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            viewport: window.innerWidth,
            borderLeft: parseFloat(barStyle.borderLeftWidth),
            borderRight: parseFloat(barStyle.borderRightWidth),
            marginLeft: containerStyle?.marginLeft,
            marginRight: containerStyle?.marginRight,
        };
    });
}

test.beforeEach(async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
});

test('the right rail mirrors the left one', async ({ page }) => {
    await setPosition(page, 'side-left');
    const left = await railMetrics(page);
    await setPosition(page, 'side-right');
    const right = await railMetrics(page);

    expect(left.rail).toBe('left');
    expect(right.rail).toBe('right');
    // Same rail, opposite edge.
    expect(right.width).toBe(left.width);
    expect(left.left).toBe(0);
    expect(right.right).toBeGreaterThanOrEqual(right.viewport - 20);

    // The divider faces the content, so it swaps sides too.
    expect(left.borderRight).toBeGreaterThan(0);
    expect(left.borderLeft).toBe(0);
    expect(right.borderLeft).toBeGreaterThan(0);
    expect(right.borderRight).toBe(0);

    // Content is pushed off the rail's edge, not the other one.
    expect(left.marginLeft).not.toBe('0px');
    expect(left.marginRight).toBe('0px');
    expect(right.marginRight).not.toBe('0px');
    expect(right.marginLeft).toBe('0px');
});

test('nothing is pushed off-screen by the right rail', async ({ page }) => {
    await setPosition(page, 'side-right');
    const offenders = await page.evaluate(() => {
        const vw = window.innerWidth;
        const out = [];
        document.querySelectorAll('*').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            if (r.right > vw + 0.5) out.push(`${el.id || el.className}`.slice(0, 40));
        });
        return out;
    });
    expect(offenders).toEqual([]);
});

test('the server keeps side-right instead of resetting it', async ({ page }) => {
    // models.go silently rewrites unknown positions to 'bottom', so a new value
    // is only real once the server has accepted it.
    await setPosition(page, 'side-right');
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });

    expect(await page.evaluate(() =>
        window.dashboardInstance.settings.buttonBarPosition)).toBe('side-right');
    expect(await page.evaluate(() =>
        document.body.getAttribute('data-rail'))).toBe('right');
});

test('config offers it and applies it without a reload', async ({ page }) => {
    await setPosition(page, 'bottom');
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.locator('[data-appearance-tab="layout"]').click();

    const choice = page.locator('[data-appearance-barpos="side-right"]');
    await expect(choice).toBeVisible();
    await choice.click();

    await expect.poll(() => page.evaluate(() =>
        document.body.getAttribute('data-rail')), { timeout: 5000 }).toBe('right');
    // Reads as copy, not a raw locale key.
    await expect(choice).not.toContainText('config.buttonBarPosition');
});
