// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config -> Monitoring -> Checks: every network check of the install in one
 * table. Problems come first, several checks can be turned on or off at once
 * (a PUT per bookmark to /api/net/checks), the count shows against the ceiling,
 * and a row opens the bookmark's Tests tab.
 *
 * The checks are real (written through the API); only the bulk read is
 * patched so two of them have a state, since nothing here may touch a network.
 */

const SETTINGS = { netToolsEnabled: false, netToolsMaxChecks: 200 };

async function seed(page) {
  return page.evaluate(async () => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const bms = window.dashboardInstance.bookmarks.slice(0, 2).map((b) => ({ url: b.url, name: b.name }));
    const put = (bm, checks) => f('/api/net/checks', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: 1, url: bm.url, checks }),
    });
    await put(bms[0], [{ type: 'tcp', port: 443, enabled: true }, { type: 'ping', enabled: false }]);
    await put(bms[1], [{ type: 'tcp', port: 22, enabled: true, muted: true }]);
    return bms;
  });
}

const listed = (page) => page.evaluate(async () => (await (await fetch('/api/net/checks', { cache: 'no-store' })).json()).items
  .map((i) => ({ id: i.checkId, label: i.label, enabled: i.enabled })));

async function open(page) {
  await markWhatsNewSeen(page);
  // The first scheduled check is shown as down, the second as up; the rest have no result.
  await page.route((url) => url.pathname === '/api/net/checks' && !url.search, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    body.items.forEach((item) => {
      if (item.label === 'TCP 22') item.state = { at: Date.now() - 60_000, ok: false, ms: 0, class: 'refused', detail: 'connection refused' };
      if (item.label === 'TCP 443') item.state = { at: Date.now() - 60_000, ok: true, ms: 18 };
    });
    return route.fulfill({ response: res, json: body });
  });
  await page.goto('/');
  await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
  await page.evaluate(async (settings) => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const current = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    await f('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, ...settings }) });
  }, SETTINGS);
  await seed(page);
  await page.evaluate(() => {
    const c = window.dashboardInstance.config;
    c.monitoringTab = 'checks';
    return c.openConfigView('monitoring');
  });
  await page.waitForSelector('[data-net-ov-list] [data-net-ov-row]', { timeout: 15_000 });
}

const rows = (page) => page.locator('[data-net-ov-row]');

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const current = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    await f('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, netToolsEnabled: true, netToolsMaxChecks: 200 }),
    });
  }).catch(() => {});
});

test('every check is a row, problems first, with the count against the limit', async ({ page }) => {
  await open(page);
  await expect(rows(page)).toHaveCount(3);
  // Down first, then no result yet, then up, and the one that is not scheduled last.
  await expect(rows(page).nth(0)).toHaveAttribute('data-state', 'down');
  await expect(rows(page).nth(0)).toContainText('TCP 22');
  await expect(rows(page).nth(0)).toContainText('Muted');
  await expect(rows(page).nth(1)).toHaveAttribute('data-state', 'ok');
  await expect(rows(page).nth(1)).toContainText('18 ms');
  await expect(rows(page).nth(2)).toHaveAttribute('data-state', 'off');
  await expect(page.locator('[data-net-ov-count]')).toHaveText('2 of 200 checks scheduled');
});

test('turning several checks off at once, and one back on', async ({ page }) => {
  await open(page);
  await page.locator('[data-net-ov-all]').check();
  await expect(page.locator('[data-net-ov-selected]')).toHaveText('3 selected');
  await page.locator('[data-net-ov-bulk="off"]').click();
  await expect(page.locator('[data-net-ov-count]')).toHaveText('0 of 200 checks scheduled');
  expect((await listed(page)).every((c) => !c.enabled)).toBe(true);

  // One switch turns one check on again, and the other settings of the check stay.
  await rows(page).filter({ hasText: 'TCP 443' }).locator('[data-net-ov-enabled]').check();
  await expect(page.locator('[data-net-ov-count]')).toHaveText('1 of 200 checks scheduled');
  const after = await listed(page);
  expect(after.filter((c) => c.enabled).map((c) => c.label)).toEqual(['TCP 443']);
  expect(after).toHaveLength(3);
});

test('over the limit nothing is turned on', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const current = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    await f('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, netToolsMaxChecks: 2 }) });
  });
  // The settings are read again with the page.
  await page.reload();
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const c = window.dashboardInstance.config;
    c.monitoringTab = 'checks';
    return c.openConfigView('monitoring');
  });
  await page.waitForSelector('[data-net-ov-list] [data-net-ov-row]');
  await expect(page.locator('[data-net-ov-count]')).toHaveText('2 of 2 checks scheduled');
  await rows(page).filter({ hasText: 'Ping' }).locator('[data-net-ov-select]').check();
  await page.locator('[data-net-ov-bulk="on"]').click();
  await expect(page.locator('[data-net-ov-count]')).toHaveText('2 of 2 checks scheduled');
  expect((await listed(page)).filter((c) => c.enabled)).toHaveLength(2);
});

test('a row opens the bookmark on its Tests tab', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__opened = [];
    window.dashboardInstance.config.openLibraryOnBookmark = (...args) => { window.__opened.push(args); return Promise.resolve(); };
  });
  await rows(page).nth(1).locator('.net-ov-bookmark').click();
  const opened = await page.evaluate(() => window.__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0][2]).toMatchObject({ tab: 'tests' });
});
