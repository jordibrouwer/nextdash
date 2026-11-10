// @ts-check
const { test, expect } = require('./fixtures');
const { useClassicType, dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * DNS checks: the form, the result panel of a one-off lookup, the line that
 * says the records changed (with its Accept button) and the bell's row for the
 * same change. The server's answers are stubbed: what is under test is how the
 * panel draws them and what its buttons send.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-tests]');

function stubChecks(page, getChecks) {
  return page.route(/\/api\/net\/checks\?/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: getChecks() }) });
  });
}

async function openTests(page, getChecks) {
  if (getChecks) await stubChecks(page, getChecks);
  const { bookmarks } = await openBookmarksWithHealth(page);
  const target = bookmarks[2];
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: target.name }) }).first().click();
  await expect(panel(page).locator('.config-bm-panel-title')).toHaveText(target.name);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('4');
  await expect(panel(page).locator('[data-bm-pane="tests"]')).toBeVisible();
  return target;
}

const dnsCheck = (extra = {}) => ({
  id: 'aaaaaaaaaaaa', type: 'dns', record: 'MX', watchDrift: true, enabled: true, display: 'DNS · MX',
  state: { at: Date.now(), ok: true, ms: 9, detail: 'MX 10 mail.example.org +1 more' },
  stats: { uptime24h: { samples: 4, ratio: 1 }, heartbeat: [] },
  ...extra,
});

test.beforeEach(async ({ page }) => {
  await useClassicType(page);
});

test.describe('DNS checks in the Tests tab', () => {
  test('the form asks for a record, starts watching for MX and not for A, and saves what was chosen', async ({ page }) => {
    const puts = [];
    await page.route((url) => url.pathname === '/api/net/checks', (route) => {
      const req = route.request();
      if (req.method() !== 'PUT') return route.fallback();
      const body = JSON.parse(req.postData() || '{}');
      puts.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: body.checks.map((c) => ({ ...c, id: 'aaaaaaaaaaaa' })) }) });
    });
    await openTests(page);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('dns');

    await expect(form.locator('[data-net-field="record"]')).toBeVisible();
    // A first: records that rotate behind a CDN are not watched until asked.
    await expect(form.locator('[data-net-field="record"]')).toHaveValue('A');
    await expect(form.locator('[data-net-field="watchDrift"]')).toHaveValue('off');
    await form.locator('[data-net-field="record"]').selectOption('MX');
    await expect(form.locator('[data-net-field="watchDrift"]')).toHaveValue('on');
    await form.locator('[data-net-field="expect"]').fill('mail.example.org');
    await expect(form.locator('[data-net-explain]')).toContainText('MX records');

    await form.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].checks[0]).toMatchObject({ type: 'dns', record: 'MX', expect: 'mail.example.org', watchDrift: true, enabled: true });
  });

  test('a changed record set shows what changed, and Accept sends the check to accept-baseline', async ({ page }) => {
    let drift = 'MX +20 mail2.example.org';
    const accepts = [];
    await page.route((url) => url.pathname === '/api/net/accept-baseline', (route) => {
      accepts.push(JSON.parse(route.request().postData() || '{}'));
      drift = '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: 1 }) });
    });
    await openTests(page, () => [dnsCheck(drift ? { driftDiff: drift, driftAt: Date.now() } : {})]);
    const card = net(page).locator('[data-net-card]');
    await card.waitFor();
    await page.evaluate(() => document.querySelectorAll('[data-net-card]').forEach((d) => { d.open = true; }));

    const line = card.locator('[data-net-drift]');
    await expect(line).toContainText('DNS changed');
    await expect(line).toContainText('MX +20 mail2.example.org');
    // The check itself is still up: a change is information, not an outage.
    await expect(card).toHaveAttribute('data-state', 'ok');

    await line.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => accepts.length).toBe(1);
    expect(accepts[0]).toEqual({ checkId: 'aaaaaaaaaaaa' });
    await expect(net(page).locator('[data-net-drift]')).toHaveCount(0);
  });

  test('a one-off DNS lookup sends the chosen record and shows the records as a table', async ({ page }) => {
    const runs = [];
    await page.route((url) => url.pathname === '/api/net/run', (route) => {
      runs.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          type: 'dns', ok: true, ms: 12, host: 'example.org', detail: 'MX 10 mail.example.org. +1 more',
          dns: { record: 'MX', resolver: 'system', queryMs: 12, records: [{ value: 'mail.example.org.', prio: 10 }, { value: 'mail2.example.org.', prio: 20 }], changed: true, diff: 'MX +20 mail2.example.org.' },
        }),
      });
    });
    await openTests(page);
    await net(page).locator('[data-net-run-record]').selectOption('MX');
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'DNS' }).click();
    await expect.poll(() => runs.length).toBe(1);
    expect(runs[0]).toEqual({ pageId: expect.any(Number), url: expect.any(String), type: 'dns', record: 'MX' });

    const result = net(page).locator('[data-tests-result="dns"]');
    await expect(result).toContainText('MX');
    await expect(result).toContainText('system resolver');
    await expect(result).toContainText('12 ms');
    const rows = result.locator('[data-net-dns-table] tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('mail.example.org.');
    await expect(rows.first()).toContainText('10');
    await expect(result.locator('[data-net-dns-changed]')).toContainText('MX +20 mail2.example.org.');
  });

  test('a lookup that finds nothing says which record was missing', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/net/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ type: 'dns', ok: false, class: 'dns', host: 'nope.example', error: 'No A records found for nope.example.', dns: { record: 'A', resolver: 'system', records: [] } }),
    }));
    await openTests(page);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'DNS' }).click();
    const block = net(page).locator('[data-net-error-class="dns"]');
    await expect(block).toContainText('No A records');
  });
});

test.describe('the bell row for a changed DNS record', () => {
  const item = (extra = {}) => ({
    pageId: 1, url: 'https://mail.example/', name: 'Mail', checkId: 'aaaaaaaaaaaa', type: 'dns', label: 'DNS · MX',
    enabled: true, muted: false, state: { at: Date.now() - 60_000, ok: true, ms: 12 },
    driftDiff: 'MX +mail2.example.org', driftAt: Date.now() - 3_600_000, ...extra,
  });

  async function stubBulk(page, bulk) {
    const accepts = [];
    await page.route((url) => url.pathname === '/api/net/checks', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ items: bulk.items, counts: {} }),
    }));
    await page.route((url) => url.pathname === '/api/net/accept-baseline', (route) => {
      accepts.push(JSON.parse(route.request().postData() || '{}'));
      bulk.items.forEach((i) => { i.driftDiff = ''; });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: 1 }) });
    });
    return accepts;
  }

  async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.NetBellSource, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => { window.DiscoverabilityState.schedulePersist = () => {}; });
  }

  const refresh = (page) => page.evaluate(async () => {
    window.NetBellSource.refresh();
    await window.NotificationBell.refreshAll();
  });
  const row = (page) => page.locator('.notification-bell-row[data-bell-id="net-dns"]');

  test('says what changed and Accept sends the check; muted and unscheduled checks make no row', async ({ page }) => {
    const bulk = { items: [item(), item({ checkId: 'bbbbbbbbbbbb', muted: true }), item({ checkId: 'cccccccccccc', enabled: false })] };
    const accepts = await stubBulk(page, bulk);
    await load(page);
    await refresh(page);
    await page.locator('.notification-bell-button').click();
    await expect(page.locator('.notification-bell-panel')).toBeVisible();

    await expect(row(page)).toContainText('Mail · DNS · MX · DNS changed: MX +mail2.example.org');
    await row(page).getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => accepts.length).toBe(1);
    expect(accepts[0]).toEqual({ checkId: 'aaaaaaaaaaaa' });
    await expect(row(page)).toHaveCount(0);
  });
});
