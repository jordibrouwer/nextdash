const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * A domain whose registry publishes no date (.nl, .de ...) gets a date field in
 * the bookmark's Expectations panel, saved per registered domain in settings.
 */
test.describe('bookmarks: expiry date typed by hand for a domain', () => {
  const section = (page) => page.locator('#config-bm-panel [data-bm-section="health"]');

  async function openPanel(page, shape, report) {
    const { bookmarks } = await openBookmarksWithHealth(page, shape, { report });
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
    await page.locator('#config-bm-panel [data-bm-tab-panel="health"]').click();
    await page.locator('#config-bm-panel [data-bm-acc]').evaluateAll((all) => all.forEach((d) => { d.open = true; }));
    return bookmarks;
  }

  const hiddenDomain = (issues) => issues.map((issue, i) => (i === 0 ? { ...issue, domain: 'voorbeeld.nl' } : issue));
  const noDateReport = () => ({
    domainSummary: { enabled: true, watched: 1, noDate: [{ domain: 'voorbeeld.nl', state: 'hidden' }] },
  });

  test('the field shows for a domain without a registry date and saves into settings', async ({ page }) => {
    await page.route('**/api/health/expectations', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }),
    }));
    let saved = null;
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'POST') saved = route.request().postDataJSON();
      await route.continue();
    });
    await openPanel(page, hiddenDomain, noDateReport);
    const input = section(page).locator('[data-domain-date]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('data-domain-name', 'voorbeeld.nl');
    await input.fill('2027-03-01');
    await section(page).locator('[data-expect-save]').click();
    await expect.poll(() => saved?.domainExpiryManual?.['voorbeeld.nl']).toBe('2027-03-01');

    // Put it back: {} rather than a missing key.
    await page.evaluate(async () => {
      const d = window.dashboardInstance;
      d.settings.domainExpiryManual = {};
      await d.saveSettings();
    });
  });

  test('no field for a domain the registry gives a date for', async ({ page }) => {
    await openPanel(page, hiddenDomain, () => ({
      domainSummary: { enabled: true, watched: 1, noDate: [] },
      domains: { 'voorbeeld.nl': { domain: 'voorbeeld.nl', expiresAt: Date.now() + 90 * 86400000, state: 'ok' } },
    }));
    await expect(section(page).locator('.health-expect-form')).toBeVisible();
    await expect(section(page).locator('[data-domain-date]')).toHaveCount(0);
  });
});
