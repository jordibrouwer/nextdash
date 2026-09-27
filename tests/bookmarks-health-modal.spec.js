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

test('it fits a laptop screen without scrolling, every card in view', async ({ page }) => {
  await openBookmarksWithHealth(
    page,
    (issues) => issues.map((issue, i) => (i === 0 ? { ...issue, monitor: true } : issue)),
    {
      view: 'library',
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
  const body = page.locator('#app-modal.show .modal-body');
  await expect(body.locator('[data-bm-health-modal-card="monitors"]')).toBeVisible();
  const m = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh).toBeLessThanOrEqual(m.ch + 1);
});

test('+N pages opens the rest of the pages in the card, and folds them again', async ({ page }) => {
  await openBookmarksWithHealth(
    page,
    // Seven pages' worth, so two are past the five the card shows.
    (issues) => issues.map((issue, i) => ({ ...issue, pageId: 9000 + (i % 7) })),
    { view: 'library', report: (issues) => ({ summary: fullSummary(issues) }) },
  );
  await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
  const card = page.locator('#app-modal.show [data-bm-health-modal-card="pages"]');
  const rows = card.locator('[data-bm-health-modal-page]');
  const toggle = card.locator('[data-bm-health-modal-pages-toggle]');
  await expect(rows.filter({ visible: true })).toHaveCount(5);
  await expect(toggle).toContainText('+2 pages');
  await toggle.click();
  await expect(rows.filter({ visible: true })).toHaveCount(7);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Still one screen.
  const body = page.locator('#app-modal.show .modal-body');
  const m = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh).toBeLessThanOrEqual(m.ch + 1);
  await toggle.click();
  await expect(rows.filter({ visible: true })).toHaveCount(5);
  // A page from the rest filters the list to it, like any other.
  await toggle.click();
  const last = rows.last();
  const pageId = await last.getAttribute('data-bm-health-modal-page');
  await last.click();
  await expect(page.locator('#app-modal.show')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => String(window.dashboardInstance.config.bmPageFilter))).toBe(pageId);
});
