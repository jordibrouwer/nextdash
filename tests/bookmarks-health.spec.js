const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Health inside the bookmark list: the Health module's report, loaded without
 * opening the Health view, joined to the bookmarks by URL.
 */
test.describe('bookmarks: the health report joined in', () => {
  test('each bookmark finds its report issue by URL', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const joined = await page.evaluate(async () => {
      const cfg = window.dashboardInstance.config;
      await cfg.bmHealth();
      return window.dashboardInstance.allBookmarks.slice(0, 2).map((b) => cfg.bmHealthIssue(b)?.score ?? null);
    });
    expect(joined).toEqual([25, 100]);
    expect(bookmarks.length).toBeGreaterThan(1);
  });

  test('the Health view is not opened to get there', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await page.evaluate(() => window.dashboardInstance.config.bmHealth());
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    await expect(page.locator('#dashboard-layout')).not.toHaveClass(/health-layout/);
  });

  test('opening the list loads the report on its own', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect.poll(() => page.evaluate(() => {
      const cfg = window.dashboardInstance.config;
      return cfg._bmHealthByUrl?.size || 0;
    })).toBeGreaterThan(0);
  });
});

test.describe('bookmarks: Health filters in the rail', () => {
  const healthItem = (page, key) => page.locator(`#config-bm-rail [data-bm-rail="health"][data-value="${key}"]`);

  test('the rail lists Health\'s filters with their counts', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect(healthItem(page, 'broken').locator('.config-bm-rail-count')).toHaveText('1');
    await expect(healthItem(page, 'stale').locator('.config-bm-rail-count')).toHaveText('1');
    await expect(healthItem(page, 'monitored')).toHaveCount(1);
  });

  test('picking Broken narrows the list to the broken bookmark', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await healthItem(page, 'broken').click();
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(1);
    await expect(page.locator('#config-bm-list .config-bm-title').first()).toHaveText(bookmarks[0].name);
  });

  test('a bookmark the report calls broken glows broken, checked by the scheduler or not', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, (issues) => issues.map((issue, i) => (i === 1
      ? { ...issue, status: 'broken', flags: ['broken'], score: 20, reasons: ['DNS lookup failed'] } : issue)));
    await page.evaluate((url) => {
      const b = window.dashboardInstance.allBookmarks.find((x) => x.url === url);
      b.checkStatus = false;
    }, bookmarks[1].url);
    await healthItem(page, 'broken').click();
    const row = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[1].name }) }).first();
    await expect(row).toHaveAttribute('data-lvs-status', 'bad');
  });

  test('the rail opens with the collection\'s health summary', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await expect(page.locator('#config-bm-rail [data-bm-health-summary]')).toContainText('%');
  });
});

test.describe('bookmarks: Health and Monitor sections in the panel', () => {
  const section = (page, name) => page.locator(`#config-bm-panel [data-bm-section="${name}"]`);

  async function pick(page, name) {
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
    await expect(page.locator('#config-bm-panel .config-bm-panel-title')).toHaveText(name);
  }

  // The panel's tabs: Health (with Monitor) and Details; the actions are
  // the head's, the rest of them under ⋯.
  async function open(page, name) {
    const tab = { edit: 'details', health: 'health', monitor: 'health' }[name];
    if (tab) {
      await page.locator(`#config-bm-panel [data-bm-tab-panel="${tab}"]`).click();
      return section(page, name);
    }
    await page.locator('#config-bm-panel [data-bm-more-toggle]').click();
    return page.locator('#config-bm-panel .config-bm-panel-head');
  }

  test('the Health section shows the broken bookmark\'s reason and score breakdown', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await pick(page, bookmarks[0].name);
    const health = await open(page, 'health');
    await expect(health).toContainText('HTTP 500');
    await expect(health.locator('.health-view-score-item').first()).toBeVisible();
    await expect(health.locator('[data-check-mode]')).toHaveCount(3);
  });

  test('the Health section fits inside the panel', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await pick(page, bookmarks[0].name);
    await open(page, 'health');
    await expect(section(page, 'health').locator('.health-expect-form')).toBeVisible();
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('#config-bm-panel').getBoundingClientRect();
      return [...document.querySelectorAll('#config-bm-panel [data-bm-section="health"] *')]
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > panel.right + 1)
        .map((el) => el.className);
    });
    expect(overflow).toEqual([]);
  });

  test('expectations saved in the panel post the bookmark\'s URL', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, (issues) => issues.map((issue, i) => (i === 0
      ? { ...issue, monitor: true, checkStatus: true } : issue)));
    let posted = null;
    await page.route('**/api/health/expectations', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', expectText: posted.expectText }) });
    });
    await pick(page, bookmarks[0].name);
    const health = await open(page, 'health');
    await health.locator('[data-expect-text]').fill('Welcome');
    await health.locator('[data-expect-save]').click();
    await expect.poll(() => posted?.expectText).toBe('Welcome');
    expect(posted.url).toBe(bookmarks[0].url);
  });

  test('the Monitor section appears for a monitored bookmark only', async ({ page }) => {
    const now = Date.now();
    const { bookmarks } = await openBookmarksWithHealth(page, (issues) => issues.map((issue, i) => (i === 0 ? {
      ...issue, monitor: true, checkStatus: true,
      monitorStats: { intervalMinutes: 5, uptime24h: { ratio: 0.9, samples: 10 }, heartbeat: [
        { state: 'up', from: now - 600000, to: now - 300000, up: 1, down: 0, avgMs: 100 },
        { state: 'up', from: now - 300000, to: now, up: 1, down: 0, avgMs: 120 },
      ], incidents: [], totalChecks: 10, lastSample: now },
    } : issue)));
    await pick(page, bookmarks[0].name);
    await expect(section(page, 'monitor')).toHaveCount(1);
    const monitor = await open(page, 'monitor');
    await expect(monitor.locator('.health-monitor-stats')).toBeVisible();
    await pick(page, bookmarks[1].name);
    await expect(section(page, 'monitor')).toHaveCount(0);
  });

  test('Re-check in the panel\'s head asks the server to check that bookmark', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /health\/(update-status|cache-scan)/.test(r.url())) posts.push(r.url()); });
    await pick(page, bookmarks[0].name);
    const actions = await open(page, 'actions');
    await actions.locator('[data-bm-health-action="recheck"]').click();
    await expect.poll(() => posts.length).toBeGreaterThan(0);
  });
});

test.describe('bookmarks: score column and Health\'s keys', () => {
  const healthItem = (page, key) => page.locator(`#config-bm-rail [data-bm-rail="health"][data-value="${key}"]`);

  async function selectRow(page, name) {
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
    // Clicking the row already moves the cursor without focusing a field;
    // this only rules out a caret left over from an earlier step in the test.
    await page.evaluate(() => document.activeElement?.blur?.());
    // The keys below act on the row's report issue; a single key press does
    // not retry the way an assertion does, so it has to land after the join
    // rather than race it. The score panel only renders once both are true.
    await expect(page.locator('#config-bm-panel .health-view-score-panel')).toBeAttached();
  }

  test('the row shows its reason under Broken, and its score either way', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await healthItem(page, 'broken').click();
    const row = page.locator('#config-bm-list .config-bm-row').first();
    await expect(row.locator('.config-bm-score')).toHaveText('25');
    await expect(row).toContainText('HTTP 500');
    await healthItem(page, 'broken').click();
    const rowAll = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first();
    await expect(rowAll.locator('.config-bm-row-score .config-bm-score')).toHaveText('25');
    await expect(rowAll.locator('.config-bm-reason')).toHaveCount(0);
  });

  test('p re-checks the selected row', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /health\/(update-status|cache-scan)/.test(r.url())) posts.push(r.url()); });
    await selectRow(page, bookmarks[0].name);
    await page.keyboard.press('p');
    await expect.poll(() => posts.length).toBeGreaterThan(0);
  });

  test('Shift+R refetches the report with refresh', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await selectRow(page, bookmarks[0].name);
    const refreshed = page.waitForRequest((r) => /\/api\/bookmark-health\?refresh=1/.test(r.url()));
    await page.keyboard.press('Shift+R');
    await refreshed;
  });

  test('s opens the panel\'s Health tab', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await selectRow(page, bookmarks[0].name);
    await page.keyboard.press('s');
    await expect(page.locator('#config-bm-panel [data-bm-pane="health"]')).toBeVisible();
  });
});

test.describe('bookmarks: Health\'s bulk actions and duplicates', () => {
  const healthItem = (page, key) => page.locator(`#config-bm-rail [data-bm-rail="health"][data-value="${key}"]`);

  async function tickFirst(page, n) {
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < n; i += 1) {
      await page.keyboard.press('j');
      await page.keyboard.press('x');
    }
    await expect(page.locator('#config-bm-panel')).toHaveAttribute('data-bm-panel-mode', 'bulk');
  }

  test('bulk Re-check posts one re-check per ticked bookmark', async ({ page }) => {
    await openBookmarksWithHealth(page);
    const posts = [];
    // update-status only: a re-check also writes the URL's cache entry, one
    // per bookmark as well, but best-effort and skipped for odd URLs.
    page.on('request', (r) => { if (r.method() === 'POST' && /health\/update-status/.test(r.url())) posts.push(r.url()); });
    await tickFirst(page, 2);
    await page.locator('#config-bm-panel [data-bm-health-bulk="recheck"]').click();
    await expect.poll(() => posts.length).toBe(2);
  });

  test('Accept drift is offered only when a ticked bookmark has drifted', async ({ page }) => {
    await openBookmarksWithHealth(page);
    await tickFirst(page, 2);
    await expect(page.locator('#config-bm-panel [data-bm-health-bulk="recheck"]')).toBeVisible();
    await expect(page.locator('#config-bm-panel [data-bm-health-bulk="accept-drift"]')).toHaveCount(0);
  });

  test('Accept drift appears for drifted bookmarks', async ({ page }) => {
    await openBookmarksWithHealth(page, (issues) => issues.map((issue) => ({ ...issue, watchDrift: true, driftNoticed: Date.now() })));
    await tickFirst(page, 2);
    await expect(page.locator('#config-bm-panel [data-bm-health-bulk="accept-drift"]')).toHaveCount(1);
  });

  test('Duplicates groups the list by URL, and Merge posts the group', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(
      page,
      (issues) => issues.map((issue, i) => (i < 2 ? { ...issue, duplicateCount: 2, flags: ['duplicate'] } : issue)),
      {
        // Two real copies of one URL, so the list has a pair to group.
        prepare: () => {
          const d = window.dashboardInstance;
          d.allBookmarks[1].url = d.allBookmarks[0].url;
        },
        report: (issues) => ({
          duplicateGroups: [{
            url: issues[0].url,
            bookmarks: [issues[0], issues[1]].map((x) => ({ pageId: x.pageId, index: x.index, name: x.name, url: x.url })),
          }],
        }),
      },
    );
    const merges = [];
    await page.route('**/api/health/merge-duplicates', (route) => {
      merges.push(route.request().postDataJSON());
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":1}' });
    });
    await healthItem(page, 'duplicate').click();
    const head = page.locator('#config-bm-list .config-bm-group-head');
    await expect(head).toHaveCount(1);
    await expect(head.locator('.config-bm-group-label')).toContainText(bookmarks[0].url);
    await expect(head.locator('.config-bm-group-count')).toHaveText('2');
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
    await page.locator('#config-bm-panel [data-bm-more-toggle]').click();
    await page.locator('#config-bm-panel [data-bm-more-menu] [data-bm-health-action="merge"]').click();
    await page.locator('#app-modal.show').getByRole('button', { name: /Merge duplicates/i }).click();
    await expect.poll(() => merges.length).toBe(1);
    expect(merges[0].targetPageId).toBe(bookmarks[0].pageId);
  });
});
