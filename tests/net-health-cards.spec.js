const { test, expect } = require('./fixtures');
const { useClassicType } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * What the Tests tab shows of a bookmark's network checks: an accordion per
 * check with its state, and for a failure the block that says what to do. The
 * server's answer is stubbed: what is under test is how it is drawn.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-tests]');

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
  await page.keyboard.press('4');
  await expect(panel(page).locator('[data-bm-pane="tests"]')).toBeVisible();
  // Each check is an accordion, closed until opened: open them for what is read inside.
  if (checks && checks.length) {
    await net(page).locator('[data-net-card]').first().waitFor();
    await page.evaluate(() => document.querySelectorAll('[data-net-card]').forEach((d) => { d.open = true; }));
  }
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
    await expect(card.locator('summary')).toContainText('TCP 8443');
    await expect(card.locator('summary .config-bm-acc-answer')).toHaveText('Up · 12 ms');
    await expect(card).toContainText('100% in 24 h');
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
    await expect(card.locator('summary .config-bm-acc-answer')).toContainText('down');
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
    await form.locator('[data-net-field="type"]').selectOption('tcp');
    await expect(explain).not.toContainText('ICMP is not used here');
    await form.locator('[data-net-field="type"]').selectOption('ping');
    await expect(explain).toContainText('ICMP is not used here');
  });
  test('the tab shows a red dot and the overview counts when a check is down; Health points to it', async ({ page }) => {
    await open(page, [
      { id: 'eeeeeeeeeeee', type: 'tcp', port: 22, enabled: true, state: { at: Date.now(), ok: true, ms: 5 }, stats: { uptime24h: { samples: 10, ratio: 1 }, heartbeat: heartbeat(['up']) } },
      ping({ at: Date.now(), ok: false, ms: 0, class: 'timeout' }),
    ]);
    await expect(panel(page).locator('[data-bm-tab-panel="tests"] .config-bm-tab-dot')).toBeVisible();
    const tiles = net(page).locator('[data-net-tiles] > div');
    await expect(tiles.nth(0)).toContainText('2');
    await expect(tiles.nth(1)).toContainText('1');
    // Health has no checks of its own, only a line that opens this tab.
    await page.keyboard.press('2');
    const line = panel(page).locator('[data-bm-pane="health"] [data-bm-net-line]');
    await expect(line).toContainText('2 checks · 1 down');
    await expect(panel(page).locator('[data-bm-pane="health"] [data-net-card], [data-bm-pane="health"] [data-net-form]')).toHaveCount(0);
    await line.getByRole('button', { name: 'Open Tests' }).click();
    await expect(panel(page).locator('[data-bm-pane="tests"]')).toBeVisible();
  });

  test('a bookmark without checks offers Run once, open, and says nothing on Health', async ({ page }) => {
    await open(page, []);
    await expect(net(page).locator('[data-bm-acc="run"]')).toHaveAttribute('open', '');
    await expect(net(page).locator('[data-net-run-types] button')).toHaveText(['TCP', 'Ping', 'DNS', 'TLS']);
    await page.keyboard.press('2');
    await expect(panel(page).locator('[data-bm-pane="health"] [data-bm-net-line]')).toBeHidden();
  });

  test('Run once shows the answer and Save as scheduled check opens the form on that type', async ({ page }) => {
    let body = null;
    await page.route('**/api/net/run', (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'tcp', ok: true, ms: 21, host: 'x.example', ip: '203.0.113.9', port: 443 }) });
    });
    await open(page, []);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'TCP' }).click();
    const result = net(page).locator('[data-tests-result="tcp"]');
    await expect(result).toContainText('Port open');
    await expect(result).toContainText('21 ms');
    // Only the bookmark and the type travel: never a host or a port.
    expect(Object.keys(body).sort()).toEqual(['pageId', 'type', 'url']);
    await result.getByRole('button', { name: 'Save as scheduled check...' }).click();
    const form = net(page).locator('[data-net-form]');
    await expect(form).toBeVisible();
    await expect(form.locator('[data-net-field="type"]')).toHaveValue('tcp');
  });

  /* ── TLS ─────────────────────────────────────────────────────────────── */

  const DAY = 24 * 3600 * 1000;
  const tlsOk = (days) => ({
    type: 'tls', ok: true, warn: days < 14, ms: 41, host: 'x.example', ip: '203.0.113.9', port: 443, secondary: days,
    detail: days < 14 ? `${days} days left` : `TLS 1.3, ${days} days left`,
    tls: {
      version: 'TLS 1.3', cipher: 'TLS_AES_128_GCM_SHA256', alpn: 'h2', daysLeft: days, valid: true, chainTotal: 2, serverName: 'x.example',
      chain: [
        { subject: 'x.example', issuer: 'R11', notBefore: Date.now() - 60 * DAY, notAfter: Date.now() + days * DAY, sigAlg: 'SHA256-RSA', san: ['x.example', '*.example.org'], sanMore: 3 },
        { subject: 'R11', issuer: 'ISRG Root X1', notBefore: Date.now() - 400 * DAY, notAfter: Date.now() + 900 * DAY, sigAlg: 'SHA256-RSA' },
      ],
    },
  });

  test('Run once reads a certificate: days left, version, protocol, cipher and the chain', async ({ page }) => {
    let body = null;
    await page.route('**/api/net/run', (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tlsOk(12)) });
    });
    await open(page, []);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'TLS' }).click();
    const result = net(page).locator('[data-tests-result="tls"]');
    await expect(result).toHaveAttribute('data-state', 'warn');
    const chips = result.locator('[data-net-tls-chips]');
    await expect(chips.locator('[data-net-tls-days]')).toHaveText('12 days left');
    await expect(chips.locator('[data-net-tls-days]')).toHaveAttribute('data-state', 'warn');
    await expect(chips).toContainText('TLS 1.3');
    await expect(chips).toContainText('h2');
    await expect(chips).toContainText('TLS_AES_128_GCM_SHA256');
    const certs = result.locator('[data-net-cert]');
    await expect(certs).toHaveCount(2);
    await expect(certs.nth(0)).toContainText('x.example');
    await expect(certs.nth(0)).toContainText('Issuer: R11');
    await expect(certs.nth(0)).toContainText('*.example.org +3');
    await expect(certs.nth(1)).toContainText('ISRG Root X1');
    // A test names no host and no port.
    expect(Object.keys(body).sort()).toEqual(['pageId', 'type', 'url']);
  });

  test('a certificate that is not accepted still shows its chain, under the block that says why', async ({ page }) => {
    await page.route('**/api/net/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...tlsOk(-3), ok: false, warn: false, class: 'tls', error: 'The certificate expired 3 days ago.', detail: 'expired 3 days ago', tls: { ...tlsOk(-3).tls, valid: false, version: '', cipher: '', alpn: '' } }),
    }));
    await open(page, []);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'TLS' }).click();
    const result = net(page).locator('[data-tests-result="tls"]');
    await expect(result).toHaveAttribute('data-state', 'down');
    const block = result.locator('[data-net-error-class="tls"]');
    await expect(block).toContainText('Certificate expired');
    await expect(block).toContainText('The certificate expired 3 days ago.');
    await expect(result.locator('[data-net-tls-days]')).toHaveText('expired 3 days ago');
    await expect(result.locator('[data-net-cert]')).toHaveCount(2);
  });

  test('a scheduled TLS check shows its days left, as a warning under its threshold', async ({ page }) => {
    await open(page, [{
      id: 'ffffffffffff', type: 'tls', port: 8443, minDaysLeft: 21, enabled: true, display: 'TLS 8443',
      state: { at: Date.now(), ok: true, warn: true, ms: 30, detail: '12 days left', secondary: 12 },
      stats: { uptime24h: { samples: 20, ratio: 1 }, heartbeat: heartbeat(['up', 'up']) },
    }]);
    const card = net(page).locator('[data-net-card]');
    await expect(card).toHaveAttribute('data-state', 'warn');
    await expect(card.locator('summary')).toContainText('TLS 8443');
    await expect(card.locator('summary .config-bm-acc-answer')).toHaveText('12 days left');
    await expect(card).toContainText('12 days left');
    // A warning is not an outage: no red dot on the tab.
    await expect(panel(page).locator('[data-bm-tab-panel="tests"] .config-bm-tab-dot')).toHaveCount(0);
  });

  test('a scheduled TLS check with an expired certificate is down and says it expired', async ({ page }) => {
    await open(page, [{
      id: 'gggggggggggg', type: 'tls', enabled: true, display: 'TLS',
      state: { at: Date.now(), ok: false, ms: 30, class: 'tls', detail: 'expired 3 days ago', secondary: -3 },
      stats: { heartbeat: heartbeat(['down']), downSince: Date.now() - 600_000 },
    }]);
    const card = net(page).locator('[data-net-card]');
    await expect(card).toHaveAttribute('data-state', 'down');
    await expect(card.locator('[data-net-error-class="tls"]')).toContainText('Certificate expired');
  });

  test('the TLS form asks for a port and a warning threshold, and says what it does', async ({ page }) => {
    await open(page, []);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('tls');
    await expect(form.locator('[data-net-field="port"]')).toHaveAttribute('placeholder', /^\d+$/);
    await expect(form.locator('[data-net-field="minDaysLeft"]')).toHaveAttribute('placeholder', '14');
    const explain = form.locator('[data-net-explain]');
    await expect(explain).toContainText('Warning when 14 days or fewer are left');
    await form.locator('[data-net-field="minDaysLeft"]').fill('30');
    await expect(explain).toContainText('Warning when 30 days or fewer are left');
    await form.locator('[data-net-field="minDaysLeft"]').fill('500');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.locator('[data-net-field-wrap="minDaysLeft"] .config-bm-field-status')).toContainText('between 1 and 120');
  });

  test('saving a TLS check sends its port and threshold and nothing of another type', async ({ page }) => {
    let put = null;
    await page.route('**/api/net/checks', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      put = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: put.checks.map((c, i) => ({ ...c, id: `00000000000${i}` })) }) });
    });
    await open(page, []);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('tls');
    await form.locator('[data-net-field="port"]').fill('8443');
    await form.locator('[data-net-field="minDaysLeft"]').fill('21');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => put).not.toBeNull();
    expect(put.checks).toHaveLength(1);
    expect(put.checks[0]).toMatchObject({ type: 'tls', port: 8443, minDaysLeft: 21, enabled: true });
    expect(put.checks[0]).not.toHaveProperty('count');
    expect(put.checks[0]).not.toHaveProperty('record');
  });
});
