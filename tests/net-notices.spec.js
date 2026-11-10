// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The bell's rows for network checks: "down" and "back up". The bulk answer
 * of GET /api/net/checks is stubbed, since what is under test is which checks
 * make a row and what the row's buttons send.
 */

const NOW = () => Date.now();

function item(id, name, label, extra = {}) {
  return {
    pageId: 1, url: `https://${id}.example/`, name, checkId: id, type: 'tcp', label,
    enabled: true, muted: false, state: { at: NOW() - 60_000, ok: true, ms: 12 }, ...extra,
  };
}

const down = (extra = {}) => ({ state: { at: NOW() - 120_000, ok: false, class: 'refused' }, ...extra });

/** Stub the bulk list; `bulk.items` can be changed by the test, and a PUT is recorded. */
async function stubNet(page, bulk, { listFor } = {}) {
  const puts = [];
  await page.route((url) => url.pathname === '/api/net/checks', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      puts.push(body);
      // What the server would do: the muted flag shows in the bulk list afterwards.
      body.checks.filter((c) => c.muted).forEach((c) => {
        const it = bulk.items.find((i) => i.checkId === c.id);
        if (it) it.muted = true;
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: body.checks }) });
    }
    if (new URL(req.url()).search) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: listFor ? listFor(new URL(req.url())) : [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: bulk.items, counts: {} }) });
  });
  return puts;
}

async function load(page) {
  await markWhatsNewSeen(page);
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.NetBellSource, null, { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  // Marks of the bell stay in the page: the tests share ./data with the dev server.
  await page.evaluate(() => { window.DiscoverabilityState.schedulePersist = () => {}; });
}

const refresh = (page) => page.evaluate(async () => {
  window.NetBellSource.refresh();
  await window.NotificationBell.refreshAll();
});
const row = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);

async function openPanel(page) {
  await page.locator('.notification-bell-button').click();
  await expect(page.locator('.notification-bell-panel')).toBeVisible();
  await expect(page.locator('.notification-bell-panel')).not.toHaveClass(/is-growing/);
}

test('a down check is a row in the bell, a recovered one another; muted and unscheduled checks are left out', async ({ page }) => {
  const bulk = {
    items: [
      item('aaaaaaaaaaaa', 'Plex', 'TCP 32400', down()),
      item('bbbbbbbbbbbb', 'NAS', 'Ping', down({ muted: true })),
      item('cccccccccccc', 'Router', 'TCP 22', down({ enabled: false })),
      item('dddddddddddd', 'Wiki', 'TCP 443', { recoveredAt: NOW() - 3_600_000 }),
      item('eeeeeeeeeeee', 'Mail', 'TCP 25'),
    ],
  };
  await stubNet(page, bulk);
  await load(page);
  await refresh(page);
  await openPanel(page);

  await expect(row(page, 'net-down')).toContainText('Plex · TCP 32400 is down');
  await expect(row(page, 'net-up')).toContainText('Wiki · TCP 443 is back up');
  // Like the outage row, they list; they never count on the bell: with the
  // checks gone the badges are what they were.
  const withRows = await page.evaluate(() => window.NotificationBell.counts());
  bulk.items = [];
  await refresh(page);
  await expect(row(page, 'net-down')).toHaveCount(0);
  expect(await page.evaluate(() => window.NotificationBell.counts())).toEqual(withRows);
});

test('several down checks are one row with a count', async ({ page }) => {
  const bulk = { items: [
    item('aaaaaaaaaaaa', 'Plex', 'TCP 32400', down()),
    item('bbbbbbbbbbbb', 'NAS', 'Ping', down()),
  ] };
  await stubNet(page, bulk);
  await load(page);
  await refresh(page);
  await openPanel(page);
  await expect(row(page, 'net-down')).toContainText('2 network checks are down');
});

test('Mute sends the whole list with only that check muted, and the row goes', async ({ page }) => {
  const bulk = { items: [item('aaaaaaaaaaaa', 'Plex', 'TCP 32400', down())] };
  const stored = [
    { id: 'aaaaaaaaaaaa', type: 'tcp', port: 32400, enabled: true, display: 'TCP 32400', state: { ok: false }, stats: {} },
    { id: 'ffffffffffff', type: 'ping', enabled: true, display: 'Ping' },
  ];
  const puts = await stubNet(page, bulk, { listFor: () => stored });
  await load(page);
  await refresh(page);
  await openPanel(page);
  await expect(row(page, 'net-down')).toBeVisible();

  await row(page, 'net-down').getByRole('button', { name: 'Mute' }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].pageId).toBe(1);
  expect(puts[0].url).toBe('https://aaaaaaaaaaaa.example/');
  expect(puts[0].checks).toEqual([
    { id: 'aaaaaaaaaaaa', type: 'tcp', port: 32400, enabled: true, muted: true },
    { id: 'ffffffffffff', type: 'ping', enabled: true },
  ]);
  await expect(row(page, 'net-down')).toHaveCount(0);
});

test('Health opens the bookmark on its Health tab', async ({ page }) => {
  const bulk = { items: [item('aaaaaaaaaaaa', 'Plex', 'TCP 32400', down())] };
  await stubNet(page, bulk);
  await load(page);
  await page.evaluate(() => {
    window.__opened = null;
    window.dashboardInstance.config.openLibraryOnBookmark = (...args) => { window.__opened = args; };
  });
  await refresh(page);
  await openPanel(page);
  await row(page, 'net-down').getByRole('button', { name: 'Health' }).click();
  await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([1, 'https://aaaaaaaaaaaa.example/', { tab: 'health', focusRow: true }]);
});

test('a check that works over TCP because ICMP is blocked makes no row', async ({ page }) => {
  const bulk = { items: [item('aaaaaaaaaaaa', 'Plex', 'Ping', { type: 'ping', state: { at: NOW(), ok: true, ms: 9, detail: 'via TCP', viaTcp: true } })] };
  await stubNet(page, bulk);
  await page.route('**/api/net/capabilities', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ enabled: true, icmp: 'blocked', pingMode: 'auto', allowCustomHost: false, maxChecks: 200, scheduled: 1, typesBuilt: ['ping', 'tcp'] }),
  }));
  await load(page);
  await refresh(page);
  await openPanel(page);
  await expect(row(page, 'net-down')).toHaveCount(0);
  await expect(row(page, 'net-up')).toHaveCount(0);
});
