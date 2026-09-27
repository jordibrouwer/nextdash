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

/*
 * A smaller window: the cards step down (tighter, more columns, smaller type)
 * until they fit, rather than the modal growing a scrollbar.
 */
for (const [width, height] of [[1100, 640], [1280, 640]]) {
  test(`at ${width}x${height} it still fits without scrolling`, async ({ page }) => {
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
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
    const body = page.locator('#app-modal.show .modal-body');
    await expect(body.locator('[data-bm-health-modal-card="monitors"]')).toBeVisible();
    await expect.poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  });
}

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

/*
 * Two tabs: the collection at a glance, then the monitors and the collection's
 * course over time, each with room for more than one screen would hold.
 */
test('Monitors & trend: the course in any series, every monitor together, remembered', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('nextdash.bm.healthModalTab'); } catch {} });
  const day = 86400000;
  const now = Date.now();
  await openBookmarksWithHealth(
    page,
    (issues) => issues.map((issue, i) => (i === 0 ? { ...issue, monitor: true } : issue)),
    {
      view: 'library',
      report: (issues) => ({
        summary: fullSummary(issues),
        trend: [
          { t: now - 2 * day, n: 10, h: 8, c: 80, b: 2 },
          { t: now - day, n: 10, h: 9, c: 85, b: 1 },
          { t: now, n: 10, h: 10, c: 90, b: 0 },
        ],
        fleet: {
          monitors: 2,
          uptime24h: { ratio: 0.9, samples: 10 },
          uptime7d: { ratio: 0.95, samples: 50 },
          uptime30d: { ratio: 0.99, samples: 200 },
          downNow: 0,
          avgResponseMs: 120,
          worst: [{ url: 'https://slow.example.com', name: 'Slow site', ratio: 0.8, samples: 40 }],
          slower: [{ url: 'https://slow.example.com', name: 'Slow site', baselineMs: 100, recentMs: 300, changePct: 200 }],
          incidents: [{ url: 'https://slow.example.com', name: 'Slow site', start: now - 3600000, durationMs: 600000, reason: 'HTTP 502' }],
          totalIncidents: 3,
        },
      }),
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
  const modal = page.locator('#app-modal.show');
  const tab = (name) => modal.locator(`[data-bm-health-modal-tab="${name}"]`);
  await expect(tab('overview')).toHaveAttribute('aria-selected', 'true');
  await expect(modal.locator('[data-bm-health-modal-card="score"]')).toBeVisible();
  await expect(modal.locator('[data-bm-health-modal-card="trend"]')).toBeHidden();

  await tab('monitors').click();
  await expect(modal.locator('[data-bm-health-modal-card="score"]')).toBeHidden();
  const trend = modal.locator('[data-bm-health-modal-card="trend"]');
  await expect(trend).toBeVisible();
  await expect(trend.locator('svg')).toHaveAttribute('aria-label', /80% → 100%/);
  await trend.locator('[data-bm-health-trend-series="broken"]').click();
  await expect(modal.locator('[data-bm-health-modal-card="trend"] svg')).toHaveAttribute('aria-label', /2 → 0/);
  await expect(modal.locator('[data-bm-health-trend-series="broken"]')).toHaveAttribute('aria-pressed', 'true');

  await expect(modal.locator('[data-bm-health-modal-card="fleet-uptime"]')).toContainText('all 2 monitors');
  await expect(modal.locator('[data-bm-health-modal-card="fleet-worst"]')).toContainText('Slow site');
  await expect(modal.locator('[data-bm-health-modal-card="fleet-slower"]')).toContainText('+200%');
  const outages = modal.locator('[data-bm-health-modal-card="fleet-outages"]');
  await expect(outages).toContainText('Outages (3)');
  await expect(outages).toContainText('HTTP 502');
  await expect(outages).toContainText('2 more in the last 30 days');

  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
  await expect(page.locator('#app-modal.show [data-bm-health-modal-tab="monitors"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#app-modal.show [data-bm-health-modal-card="trend"]')).toBeVisible();
});

/*
 * Smaller still: the Monitors card leaves the overview (it is whole on its own
 * tab), and in the narrow columns every figure stays inside its card.
 */
test('at 1000x620 the Monitors card gives way, and nothing spills out of a card', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('nextdash.bm.healthModalTab'); } catch {} });
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
  await page.setViewportSize({ width: 1000, height: 620 });
  await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
  const body = page.locator('#app-modal.show .modal-body');
  await expect.poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await expect(body.locator('[data-bm-health-modal-card="monitors"]')).toBeHidden();
  const spills = await body.locator('[data-bm-health-modal-pane="overview"] .bm-health-modal-card').evaluateAll((cards) =>
    cards.filter((c) => c.offsetParent).flatMap((card) => {
      const edge = card.getBoundingClientRect().right;
      return [...card.querySelectorAll('span, b, i, div')]
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > edge + 1)
        .map((el) => `${card.dataset.bmHealthModalCard}: ${el.className || el.tagName} "${el.textContent.trim().slice(0, 20)}"`);
    }));
  expect(spills).toEqual([]);
  await body.locator('[data-bm-health-modal-tab="monitors"]').click();
  await expect(body.locator('[data-bm-health-modal-card="fleet-uptime"]')).toBeVisible();
});
