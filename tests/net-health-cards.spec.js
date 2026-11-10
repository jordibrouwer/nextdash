const { test, expect } = require('./fixtures');
const { useClassicType } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * What the Health tab shows of a bookmark's network checks: a card per check
 * with its state, and for a failure the block that says what to do. The
 * server's answer is stubbed: what is under test is how it is drawn.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-net]');

function heartbeat(states) {
  return states.map((state, i) => ({ from: Date.now() - (states.length - i) * 60_000, state, avgMs: state === 'up' ? 20 : 0 }));
}

function stubChecks(page, checks) {
  return page.route(/\/api\/net\/checks\?/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks }) });
  });
}

async function open(page, checks) {
  if (checks) await stubChecks(page, checks);
  const { bookmarks } = await openBookmarksWithHealth(page);
  const target = bookmarks[2];
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: target.name }) }).first().click();
  await expect(panel(page).locator('.config-bm-panel-title')).toHaveText(target.name);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('2');
  await expect(panel(page).locator('[data-bm-pane="health"]')).toBeVisible();
  return target;
}

const ping = (state, extra = {}) => ({
  id: 'aaaaaaaaaaaa', type: 'ping', enabled: true, display: 'Ping', state,
  stats: { uptime24h: { samples: 10, ratio: 0.8 }, heartbeat: heartbeat(['up', 'up', 'down', 'down']), downSince: Date.now() - 120_000 },
  ...extra,
});

test.beforeEach(async ({ page }) => {
  await useClassicType(page);
});

test.describe('network check cards', () => {
  test('a bookmark without checks only offers to add one', async ({ page }) => {
    await open(page);
    await expect(net(page).locator('[data-net-card]')).toHaveCount(0);
    await expect(net(page).getByRole('button', { name: 'Add check' })).toBeVisible();
    await expect(net(page)).toContainText('No checks yet');
  });

  test('a healthy check shows its name, state, uptime and strip', async ({ page }) => {
    await open(page, [{
      id: 'bbbbbbbbbbbb', type: 'tcp', port: 8443, enabled: true, display: 'TCP 8443',
      state: { at: Date.now(), ok: true, ms: 12, detail: '8443 open' },
      stats: { uptime24h: { samples: 20, ratio: 1 }, heartbeat: heartbeat(['up', 'up', 'up']) },
    }]);
    const card = net(page).locator('[data-net-card]');
    await expect(card).toHaveAttribute('data-state', 'ok');
    await expect(card.locator('.net-badge')).toHaveText('TCP 8443');
    await expect(card).toContainText('Up');
    await expect(card).toContainText('12 ms');
    await expect(card.locator('.net-card-uptime')).toHaveText('100%');
    await expect(card.locator('.health-heartbeat-bar')).toHaveCount(3);
    await expect(card.locator('[data-net-error-class]')).toHaveCount(0);
  });

  test('a ping that cannot use ICMP says how to allow it, with the snippet to copy', async ({ page }) => {
    await open(page, [ping({ at: Date.now(), ok: false, ms: 0, class: 'icmp' })]);
    const card = net(page).locator('[data-net-card]');
    await expect(card).toHaveAttribute('data-state', 'down');
    const block = card.locator('[data-net-error-class="icmp"]');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('role', 'status');
    await expect(block.locator('pre')).toContainText('net.ipv4.ping_group_range');
    await expect(block.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(card).toContainText('Down for');
  });

  test('a blocked address points at the Allow local bookmarks setting', async ({ page }) => {
    await open(page, [ping({ at: Date.now(), ok: false, ms: 0, class: 'guard' })]);
    const block = net(page).locator('[data-net-error-class="guard"]');
    await expect(block).toBeVisible();
    await expect(block.getByRole('button', { name: /Allow local bookmarks/ })).toBeVisible();
  });

  test('a time-out names the port and the wait', async ({ page }) => {
    await open(page, [{
      id: 'cccccccccccc', type: 'tcp', port: 8443, timeoutSec: 10, enabled: true,
      state: { at: Date.now(), ok: false, ms: 0, class: 'timeout' },
      stats: { heartbeat: heartbeat(['down']) },
    }]);
    const block = net(page).locator('[data-net-error-class="timeout"]');
    await expect(block).toContainText('Time-out after 10 s');
    await expect(block).toContainText('8443');
  });

  test('a check that is switched off says so and shows no strip', async ({ page }) => {
    await open(page, [{ id: 'dddddddddddd', type: 'ping', enabled: false, display: 'Ping' }]);
    const card = net(page).locator('[data-net-card]');
    await expect(card).toHaveAttribute('data-state', 'off');
    await expect(card).toContainText('Not scheduled');
    await expect(card.locator('.health-heartbeat')).toHaveCount(0);
  });

  test('the form warns about ICMP when this install cannot send it', async ({ page }) => {
    await page.route('**/api/net/capabilities', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ enabled: true, icmp: 'blocked', pingMode: 'auto', allowCustomHost: false, maxChecks: 200, scheduled: 0, typesBuilt: ['tcp', 'ping'] }),
    }));
    await open(page, []);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    const explain = form.locator('[data-net-explain]');
    await form.locator('[data-net-type="tcp"]').click();
    await expect(explain).not.toContainText('ICMP is not used here');
    await form.locator('[data-net-type="ping"]').click();
    await expect(explain).toContainText('ICMP is not used here');
  });
});
