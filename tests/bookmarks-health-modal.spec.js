const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The collection health modal: one page reading of how the whole collection
 * is doing, opened from the rail's summary block or the bookmark list's `h`
 * key. Every figure comes from the stubbed report, so each test supplies the
 * summary fields the card it checks actually reads.
 */
function fullSummary(issues, extra = {}) {
  return {
    totalBookmarks: issues.length,
    healthyCount: issues.length - 1,
    brokenCount: 1,
    monitorDownCount: 0,
    uncheckedCount: 0,
    ignoredCount: 0,
    ...extra,
  };
}

test.describe('bookmarks: the collection health modal', () => {
  test('clicking the summary opens the modal with the score and the stacked bar counts', async ({ page }) => {
    const { issues } = await openBookmarksWithHealth(page, (i) => i, {
      report: (issues) => ({ summary: fullSummary(issues) }),
    });
    await page.locator('[data-bm-health-summary]').click();
    const modal = page.locator('#app-modal.show');
    await expect(modal).toBeVisible();
    const expectedScore = Math.round(((issues.length - 1) / issues.length) * 100);
    await expect(modal.locator('[data-bm-health-modal-card="score"] [data-bm-health-modal-count="score"]'))
      .toHaveText(`${expectedScore}%`);
    const stand = modal.locator('[data-bm-health-modal-card="stand"]');
    await expect(stand.locator('[data-bm-health-modal-count="healthy"]')).toHaveText(String(issues.length - 1));
    await expect(stand.locator('[data-bm-health-modal-count="broken"]')).toHaveText('1');
  });

  test('clicking Broken in the modal closes it and filters the list to 1 row', async ({ page }) => {
    await openBookmarksWithHealth(page, (i) => i, {
      report: (issues) => ({ summary: fullSummary(issues) }),
    });
    await page.locator('[data-bm-health-summary]').click();
    await page.locator('#app-modal.show [data-bm-health-modal-card="kind"] [data-bm-health-modal-filter="broken"]').click();
    await expect(page.locator('#app-modal.show')).toHaveCount(0);
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(1);
  });

  test('Monitors is absent with no monitored issue', async ({ page }) => {
    await openBookmarksWithHealth(page, (i) => i, {
      report: (issues) => ({ summary: fullSummary(issues) }),
    });
    await page.locator('[data-bm-health-summary]').click();
    await expect(page.locator('#app-modal.show [data-bm-health-modal-card="monitors"]')).toHaveCount(0);
  });

  test('Monitors is present when one issue has monitor: true', async ({ page }) => {
    await openBookmarksWithHealth(
      page,
      (issues) => issues.map((issue, i) => (i === 0 ? { ...issue, monitor: true } : issue)),
      {
        report: (issues) => ({
          summary: fullSummary(issues),
          fleet: {
            monitors: 1,
            uptime24h: { ratio: 1, samples: 10 },
            uptime7d: { ratio: 1, samples: 50 },
            uptime30d: { ratio: 1, samples: 200 },
            downNow: 0,
            avgResponseMs: 120,
            worst: [],
            incidents: [],
          },
        }),
      },
    );
    await page.locator('[data-bm-health-summary]').click();
    await expect(page.locator('#app-modal.show [data-bm-health-modal-card="monitors"]')).toHaveCount(1);
  });

  test('the h key opens the modal', async ({ page }) => {
    await openBookmarksWithHealth(page, (i) => i, {
      report: (issues) => ({ summary: fullSummary(issues) }),
    });
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('h');
    await expect(page.locator('#app-modal.show')).toBeVisible();
    await expect(page.locator('#app-modal.show')).toContainText('Collection health');
  });
});

test('Collection health in the view header\'s menu opens it', async ({ page }) => {
  await openBookmarksWithHealth(page, undefined, { view: 'library' });
  await page.locator('.config-view--library .lvs-header-actions [data-bm-header-more]').click();
  const button = page.locator('.config-view--library [data-bm-header-menu] [data-bm-open-health-modal]');
  await expect(button).toBeVisible();
  await expect(button).toContainText('Collection health');
  await button.click();
  await expect(page.locator('#app-modal.show')).toContainText('Collection health');
});
