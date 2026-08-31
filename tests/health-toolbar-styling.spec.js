// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, openHealthToolbarMenu } = require('./e2e-helpers');

/**
 * Every button in the health toolbar has to look like a button in the health
 * toolbar.
 *
 * "Rot report" was added to the markup and to the click handler, and never to
 * the rule its neighbours share — so it rendered as a bare browser button
 * beside them: different height, different radius, system colours. The rule
 * lists its buttons by class, which is exactly the kind of list a new button
 * gets left out of, so this compares the whole row rather than one class.
 *
 * d4e22e33 emptied that row: everything but Work through and Rot report moved
 * behind `⋯`, where .health-view-menu restyles them as menu items — flat, no
 * border, menu type. Comparing Export to Rot report now compares two things
 * deliberately drawn differently, so the row this guards is the row that is
 * left: Rot report against the overflow button standing beside it.
 */

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.health.openHealthView());
    await page.waitForSelector('.health-view-toolbar-actions', { timeout: 20_000 });
}

const boxOf = (locator) => locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
        borderRadius: s.borderTopLeftRadius,
        borderWidth: s.borderTopWidth,
        fontSize: s.fontSize,
        padding: `${s.paddingTop} ${s.paddingRight}`,
    };
});

test('the secondary toolbar buttons are shaped alike', async ({ page }) => {
    await openHealth(page);

    const rotBtn = page.locator('.health-view-toolbar-actions .health-view-rot-btn');
    const moreBtn = page.locator('.health-view-toolbar-actions [data-health-toolbar-more]');
    await expect(rotBtn).toBeVisible();
    await expect(moreBtn).toBeVisible();

    // The overflow button carries its own rule, written to match the buttons it
    // stands among rather than itself. Rot report is the one that was left out
    // of the shared rule once already.
    const rot = await boxOf(rotBtn);
    const more = await boxOf(moreBtn);
    expect(rot.borderRadius).toBe(more.borderRadius);
    expect(rot.borderWidth).toBe(more.borderWidth);
    expect(rot.padding.split(' ')[0]).toBe(more.padding.split(' ')[0]);

    // And it is styled at all — a bare button keeps the user-agent's own border.
    const border = await rotBtn.evaluate((el) => getComputedStyle(el).borderTopColor);
    const bare = await page.evaluate(() => {
        const probe = document.createElement('button');
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return colour;
    });
    expect(border).not.toBe(bare);
});
