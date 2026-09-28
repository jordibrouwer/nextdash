const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openSearch(page, query) {
  await markWhatsNewSeen(page);
  await page.goto('/');
  await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.keyboard.press('>');
  await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
  for (const ch of query) {
    await page.keyboard.press(ch);
    await page.waitForTimeout(40);
  }
}

test.describe('docker containers in search', () => {
  test('a container is found and opens in its drawer', async ({ page }) => {
    await mockDocker(page);
    await openSearch(page, 'jellyf');
    const row = page.locator('[data-match-type="docker-container"]', { hasText: 'jellyfin' });
    await expect(row).toBeVisible();
    await expect(page.locator('.search-scope-section', { hasText: /containers/i })).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/#docker\/jellyfin$/);
    await expect(page.locator('[data-docker-drawer]')).toContainText('jellyfin');
  });

  test('Enter on the container row opens it', async ({ page }) => {
    await mockDocker(page);
    await openSearch(page, 'bazarr');
    const row = page.locator('[data-match-type="docker-container"]', { hasText: 'bazarr' });
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#docker\/bazarr$/);
  });

  test('no containers section without a socket', async ({ page }) => {
    await mockDocker(page, { socket: false });
    await openSearch(page, 'sonarr');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-match-type="docker-container"]')).toHaveCount(0);
  });
});

test.describe(':docker in the palette', () => {
  test(':docker <name> stop runs the action', async ({ page }) => {
    const state = await mockDocker(page);
    await openSearch(page, ':docker jellyfin st');
    const row = page.locator('.search-match', { hasText: /stop jellyfin/i });
    await expect(row).toBeVisible();
    await row.click();
    await expect.poll(() => state.calls).toContain('POST /containers/jellyfin/stop');
  });

  test(':docker <name> remove opens the dialog', async ({ page }) => {
    const state = await mockDocker(page);
    await openSearch(page, ':docker bazarr rem');
    await page.locator('.search-match', { hasText: /remove bazarr/i }).click();
    await expect(page.locator('.modal[role="dialog"]')).toContainText(/volumes and image stay/i);
    expect(state.calls.some((c) => c.endsWith('/remove'))).toBe(false);
  });

  test(':docker read-only offers only open and logs', async ({ page }) => {
    await mockDocker(page, { control: false });
    await openSearch(page, ':docker jellyfin ');
    await expect(page.locator('.search-match', { hasText: /open jellyfin/i })).toBeVisible();
    await expect(page.locator('.search-match', { hasText: /stop jellyfin/i })).toHaveCount(0);
  });

  test(':docker completes container names', async ({ page }) => {
    await mockDocker(page);
    await openSearch(page, ':docker so');
    await expect(page.locator('.search-match', { hasText: 'sonarr' })).toBeVisible();
  });

  test(':goto docker opens the view', async ({ page }) => {
    await mockDocker(page);
    await openSearch(page, ':goto docker');
    await page.locator('.search-match', { hasText: /containers view/i }).first().click();
    await expect(page).toHaveURL(/#docker$/);
  });
});
