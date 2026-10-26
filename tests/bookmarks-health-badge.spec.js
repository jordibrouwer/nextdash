const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The Health tab's Uptime badge section: a preview and two copy buttons for a
 * monitored bookmark while the server's switch is on, the way to the switch
 * while it is off, and nothing at all for a bookmark that is not monitored.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
const pane = (page) => drawer(page).locator('[data-bm-pane="health"]');
const badge = (page) => pane(page).locator('[data-bm-acc="badge"]');

const monitored = (now) => (issues) => issues.map((issue, i) => (i === 0 ? {
  ...issue, monitor: true, checkStatus: true,
  monitorStats: { intervalMinutes: 5, uptime24h: { ratio: 0.99, samples: 10 }, heartbeat: [
    { state: 'up', from: now - 600000, to: now, up: 2, down: 0, avgMs: 100 },
  ], incidents: [], totalChecks: 10, lastSample: now },
} : issue));

async function openHealthTab(page, name) {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
  await drawer(page).locator('[data-bm-tab-panel="health"]').click();
  await expect(pane(page)).toBeVisible();
}

test.describe('bookmark panel: the Uptime badge section', () => {
  test('switched on: a preview, a period and two copy buttons', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { bookmarks } = await openBookmarksWithHealth(page, monitored(Date.now()), {
      prepare: () => { window.dashboardInstance.settings.uptimeBadges = true; },
    });
    await openHealthTab(page, bookmarks[0].name);
    await badge(page).locator('summary').click();

    const img = badge(page).locator('[data-bm-badge-img]');
    await expect(img).toHaveAttribute('src', new RegExp(`/badge/uptime\\.svg\\?url=${encodeURIComponent(bookmarks[0].url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}&days=30$`));

    await badge(page).locator('[data-bm-badge-days="7"]').click();
    await expect(img).toHaveAttribute('src', /&days=7$/);
    await expect(badge(page).locator('summary')).toContainText('7');

    await badge(page).locator('[data-bm-badge-copy="markdown"]').click();
    const markdown = await page.evaluate(() => navigator.clipboard.readText());
    expect(markdown).toMatch(/^!\[Uptime\]\(http.*\/badge\/uptime\.svg\?url=.*&days=7\)$/);

    await badge(page).locator('[data-bm-badge-copy="html"]').click();
    const html = await page.evaluate(() => navigator.clipboard.readText());
    expect(html).toMatch(/^<img src="http.*\/badge\/uptime\.svg\?url=.*&days=7" alt="Uptime">$/);
  });

  test('switched off: no preview, a button to the switch', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, monitored(Date.now()), {
      prepare: () => { window.dashboardInstance.settings.uptimeBadges = false; },
    });
    await openHealthTab(page, bookmarks[0].name);
    await badge(page).locator('summary').click();
    await expect(badge(page).locator('[data-bm-badge-img]')).toHaveCount(0);
    await expect(badge(page).locator('[data-bm-badge-copy]')).toHaveCount(0);
    await expect(badge(page).locator('[data-bm-badge-settings]')).toBeVisible();
  });

  test('a bookmark that is not monitored has no badge section', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
      prepare: () => { window.dashboardInstance.settings.uptimeBadges = true; },
    });
    await openHealthTab(page, bookmarks[0].name);
    await expect(badge(page)).toHaveCount(0);
  });
});
