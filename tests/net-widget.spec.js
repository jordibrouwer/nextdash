// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The Network tests widget: added through the catalogue, its checks chosen from
 * the existing scheduled ones, three looks, one or two columns. It runs
 * nothing: GET /api/net/dashboard is stubbed with what the monitor loop would
 * have measured, and the widget is read to ask for nothing else.
 */

const NOW = () => Date.now();
const beat = (...s) => s;
const UP24 = Array.from({ length: 24 }, () => 'up');

function row(id, name, type, label, state, extra = {}) {
  const states = {
    ok: { at: NOW(), ok: true, ms: 23, detail: '443 open' },
    down: { at: NOW(), ok: false, class: 'timeout', detail: 'loss 100%' },
    warn: { at: NOW(), ok: true, ms: 40, warn: true, secondary: 9, detail: '9 days left' },
  };
  return {
    checkId: id, pageId: 1, url: `https://${name.toLowerCase().replace(/\W/g, '')}.example/`, name, type, label,
    enabled: true, state: states[state], beat: state === 'down' ? [...UP24.slice(0, 20), 'down', 'down', 'down', 'down'] : UP24,
    downSince: state === 'down' ? NOW() - 3600_000 : 0, intervalMinutes: 15, ...extra,
  };
}

const IDS = ['a1a1a1a1a1a1', 'b2b2b2b2b2b2', 'c3c3c3c3c3c3', 'd4d4d4d4d4d4'];

const ANSWER = () => ({
  enabled: true, fetchedAt: NOW(), counts: { total: 4, down: 1, warn: 1, slow: 0, gone: 0 },
  items: [
    row(IDS[0], 'Nextcloud', 'tcp', 'TCP 443', 'ok'),
    row(IDS[1], 'Plex', 'ping', 'Ping', 'down'),
    row(IDS[2], 'Gitea', 'tls', 'TLS', 'warn'),
  ],
});

let requests;

async function open(page, { answer = ANSWER, viewport = { width: 1400, height: 900 } } = {}) {
  requests = [];
  await markWhatsNewSeen(page);
  await page.route((url) => url.pathname === '/api/net/dashboard', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer()) });
  });
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
  await prepareDashboardInteraction(page);
}

async function putWidget(page, config, title = 'Network tests') {
  await page.evaluate(async ({ config, title }) => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
    await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [{ type: 'nettests', title, config }] }) });
  }, { config, title });
  await page.reload();
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const widget = (page) => page.locator('.dashboard-widget[data-widget-type="nettests"]');

test.afterEach(async ({ page }) => {
  // The widget lives on page 1 of the data folder the dev server shares.
  await page.evaluate(async () => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
    await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
  }).catch(() => {});
});

test.describe('the Network tests widget', () => {
  test('is added through the catalogue, takes its checks from the existing ones, and saves look and order', async ({ page }) => {
    await open(page);
    // Two scheduled checks and one that is not, through the API like the Tests tab does.
    const marks = await page.evaluate(() => window.dashboardInstance.bookmarks.slice(0, 2).map((b) => ({ url: b.url, name: b.name })));
    const put = async (bm, checks) => {
      const res = await page.request.put('/api/net/checks', { data: { pageId: 1, url: bm.url, checks }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
      expect(res.ok()).toBe(true);
    };
    await put(marks[0], [{ type: 'tcp', enabled: true, port: 443 }, { type: 'ping', enabled: false }]);
    await put(marks[1], [{ type: 'ping', enabled: true }]);

    await page.evaluate(async () => {
      const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
      const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
      await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
      await window.dashboardInstance.config.openConfigView('widgets');
    });
    await page.locator('[data-widget-catalogue]').click();
    await page.locator('.modal--widget-catalogue [data-widget-option="nettests"]').first().click();
    await page.locator('.modal--widget-catalogue [data-widget-add="nettests"]').click();
    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const panel = page.locator(`[data-widget-detail="${index}"]`);
    await expect(panel).toBeVisible();

    // Only the two scheduled checks are offered, and there is no field to type a host into.
    const field = panel.locator('[data-net-widget-checks]');
    await expect(field.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(field.locator('input[type="text"], input:not([type])')).toHaveCount(0);
    await expect(panel.getByText('runs no tests')).toBeVisible();

    await field.locator('input[type="checkbox"]').first().check();
    await field.locator('input[type="checkbox"]').nth(1).check();
    await panel.locator('[data-widget-setting="look"]').selectOption('tiles');
    await panel.locator('[data-widget-setting="sort"]').selectOption('name');
    await panel.locator('[data-widget-save]').click();

    const saved = await page.evaluate(async () => {
      const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
      const blocks = await (await send('/api/pages/1/blocks')).json();
      return (blocks.widgets || []).find((w) => w.type === 'nettests')?.config ?? null;
    });
    expect(saved.look).toBe('tiles');
    expect(saved.sort).toBe('name');
    expect(saved.checks).toHaveLength(2);
    expect(saved.checks.every((id) => /^[0-9a-f]{12}$/.test(id))).toBe(true);

    // And the dashboard draws that look from what it saved.
    await page.evaluate(() => { window.location.hash = '#1'; });
    await page.reload();
    await expect(widget(page).locator('.netw-tiles')).toBeVisible({ timeout: 15_000 });
    await expect(widget(page).locator('.netw-tile')).toHaveCount(3);
    expect(requests.at(-1)).toContain(`checks=${saved.checks.join('%2C')}`);
  });

  test('draws rows, tiles and heartbeat strips from the same answer', async ({ page }) => {
    await open(page);
    await putWidget(page, { checks: IDS.slice(0, 3), look: 'rows' });
    const w = widget(page);
    await expect(w.locator('.netw-rows')).toBeVisible({ timeout: 15_000 });
    // Problems first, then by name.
    await expect(w.locator('.netw-row .netw-name')).toHaveText(['Plex', 'Gitea', 'Nextcloud']);
    await expect(w.locator('.netw-row').first().locator('.netw-badge')).toHaveAttribute('data-state', 'down');
    await expect(w.locator('.netw-foot')).toContainText('2 with problems');

    await putWidget(page, { checks: IDS.slice(0, 3), look: 'tiles' });
    await expect(w.locator('.netw-tiles .netw-tile')).toHaveCount(3);
    await expect(w.locator('.netw-tile', { hasText: 'Gitea' }).locator('.netw-tile-value')).toHaveText('9 d');
    await expect(w.locator('.netw-tile', { hasText: 'Nextcloud' }).locator('.netw-tile-value')).toHaveText('23 ms');

    await putWidget(page, { checks: IDS.slice(0, 3), look: 'heartbeat', sort: 'name' });
    await expect(w.locator('.netw-beats .netw-beat')).toHaveCount(3);
    await expect(w.locator('.netw-beat').first().locator('.netw-strip > i')).toHaveCount(24);
    await expect(w.locator('.netw-beat', { hasText: 'Plex' }).locator('.netw-strip > i[data-beat="down"]')).toHaveCount(4);
    await expect(w.locator('.netw-beat .netw-name')).toHaveText(['Gitea', 'Nextcloud', 'Plex']);
  });

  test('one column or two: the tile decides from its own width', async ({ page }) => {
    await open(page);
    await putWidget(page, { checks: IDS.slice(0, 3), look: 'rows' });
    const tracks = () => widget(page).locator('.netw-rows').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await expect(widget(page).locator('.netw-rows')).toBeVisible({ timeout: 15_000 });
    const one = await tracks();
    await putWidget(page, { checks: IDS.slice(0, 3), look: 'rows', columns: 2 });
    await expect(widget(page).locator('.netw-rows')).toBeVisible({ timeout: 15_000 });
    expect(await tracks()).toBeGreaterThan(one);
  });

  test('nothing chosen says so; a check that is gone says so instead of failing', async ({ page }) => {
    await open(page, { answer: () => ({ enabled: true, fetchedAt: NOW(), counts: {}, items: [row(IDS[0], 'Nextcloud', 'tcp', 'TCP 443', 'ok'), { checkId: IDS[3], gone: true, enabled: false }] }) });
    await putWidget(page, {});
    await expect(widget(page)).toContainText('No checks chosen yet', { timeout: 15_000 });

    await putWidget(page, { checks: [IDS[0], IDS[3]] });
    await expect(widget(page).locator('.netw-row')).toHaveCount(2, { timeout: 15_000 });
    await expect(widget(page).locator('.netw-row').last()).toContainText('check removed');
    await expect(widget(page).locator('div.netw-row')).toHaveCount(1);
  });

  test('a row opens the bookmark on its Tests tab', async ({ page }) => {
    await open(page);
    await putWidget(page, { checks: IDS.slice(0, 3) });
    await page.evaluate(() => {
      window.__opened = [];
      window.dashboardInstance.config.openLibraryOnBookmark = (...args) => { window.__opened.push(args); return Promise.resolve(); };
    });
    await widget(page).locator('.netw-row', { hasText: 'Plex' }).click();
    const opened = await page.evaluate(() => window.__opened);
    expect(opened).toHaveLength(1);
    expect(opened[0][0]).toBe(1);
    expect(opened[0][2]).toEqual({ tab: 'tests', focusRow: true });
  });

  test('with network checks switched off it says so and shows no state', async ({ page }) => {
    await open(page, { answer: () => ({ enabled: false, items: [], fetchedAt: NOW() }) });
    await putWidget(page, { checks: IDS.slice(0, 3) });
    await expect(widget(page)).toContainText('switched off', { timeout: 15_000 });
  });
});
