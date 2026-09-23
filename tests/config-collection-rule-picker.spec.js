// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The rule picker names the category it is offering.
 *
 * A custom collection's rules match a category by its id, which is right —
 * Bookmark.Category is always an id, never the display name. But the datalist
 * behind the value field offered that id as the whole entry and nothing else,
 * so the list read as "development" or "cat_mrjjzqik_o2rt0" with nothing to say
 * which category that is. The id is still what gets filled in; the name rides
 * along as the option's text, which is where a datalist puts a description.
 */
test('a category rule offers each id with its name beside it', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
    await page.locator('[data-pt-tab="collections"]').click();

    // Rules only exist once there is a collection to hold them, so make one the
    // way the panel does.
    await page.locator('[data-collection-add]').click();
    const rule = page.locator('.config-collection-rule').first();
    await expect(rule).toBeAttached({ timeout: 10_000 });

    // A rule starts on tags; the picker under test is the category one.
    await rule.locator('select[data-rule-field]').selectOption('category');
    await expect(rule.locator('datalist option').first()).toBeAttached({ timeout: 10_000 });

    const pairs = await rule.locator('datalist option')
        .evaluateAll((nodes) => nodes.map((n) => ({ value: n.value, text: n.textContent.trim() })));

    expect(pairs.length, 'the category picker offered nothing at all').toBeGreaterThan(0);

    const named = pairs.filter((p) => p.text && p.text !== p.value);
    expect(named.length,
        `every option is a bare id: ${JSON.stringify(pairs.slice(0, 5))}`)
        .toBeGreaterThan(0);

    // And the value is still the id, because that is what the matching uses.
    const known = await page.evaluate(
        () => (window.dashboardInstance.categories || []).map((c) => String(c.id)));
    const offered = pairs.map((p) => p.value);
    expect(known.some((id) => offered.some((v) => v.endsWith(id))),
        `no offered value matches a category id: ${JSON.stringify(offered.slice(0, 5))}`).toBe(true);
});
