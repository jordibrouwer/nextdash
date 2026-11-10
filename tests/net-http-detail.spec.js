const { test, expect } = require('./fixtures');
const { useClassicType } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * What the Tests tab shows of an HTTP-detail run: chips, the timeline as bars,
 * the redirect chain, the headers (first three, the rest folded), a failure and
 * a redirect the address guard refused; and what the form sends. The server's
 * answer is stubbed: what is under test is how it is drawn and what is sent.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-tests]');

async function open(page, checks = []) {
  await page.route(/\/api\/net\/checks\?/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks }) });
  });
  const { bookmarks } = await openBookmarksWithHealth(page);
  const target = bookmarks[2];
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: target.name }) }).first().click();
  await expect(panel(page).locator('.config-bm-panel-title')).toHaveText(target.name);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('4');
  await expect(panel(page).locator('[data-bm-pane="tests"]')).toBeVisible();
  return target;
}

const headers = Array.from({ length: 14 }, (_, i) => ({ name: `x-extra-${String(i).padStart(2, '0')}`, value: `v${i}` }))
  .concat([
    { name: 'server', value: 'nginx' },
    { name: 'strict-transport-security', value: 'max-age=15552000' },
    { name: 'content-type', value: 'text/html; charset=utf-8' },
    { name: 'set-cookie', value: '[hidden]' },
  ]);

const httpOk = {
  type: 'http', ok: true, ms: 96, host: 'x.example', ip: '203.0.113.9', port: 443, detail: '200 · 2 redirects',
  http: {
    status: 200, proto: 'HTTP/2', ip: '203.0.113.9', size: 34200, url: 'https://x.example/login',
    timings: { dnsMs: 12, connectMs: 28, tlsMs: 41, waitMs: 96, transferMs: 18, redirectMs: 99, ttfbMs: 195, totalMs: 213 },
    redirects: [
      { url: 'http://x.example/', status: 301, ms: 38 },
      { url: 'https://x.example/', status: 302, ms: 61 },
    ],
    headers, headersTotal: 22, expectStatus: '200-299',
  },
};

test.beforeEach(async ({ page }) => {
  await useClassicType(page);
});

test.describe('HTTP-detail in the Tests tab', () => {
  test('Run once shows chips, the timeline, the redirect chain and the headers', async ({ page }) => {
    let body = null;
    await page.route('**/api/net/run', (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(httpOk) });
    });
    await open(page);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'HTTP' }).click();
    const result = net(page).locator('[data-tests-result="http"]');
    await expect(result).toHaveAttribute('data-state', 'ok');
    const chips = result.locator('[data-net-http-chips]');
    await expect(chips.locator('[data-net-http-status]')).toHaveText('200');
    await expect(chips).toContainText('HTTP/2');
    await expect(chips).toContainText('213 ms total');
    await expect(chips).toContainText('34.2 KB');
    // The timeline: the redirects lead, then DNS, connect, TLS, first byte, download.
    const wf = result.locator('[data-net-wf]');
    await expect(wf.locator('.net-wf-label')).toHaveText(['Redirects', 'DNS', 'Connect', 'TLS', 'First byte', 'Download']);
    await expect(wf.locator('.net-wf-ms')).toHaveText(['99 ms', '12 ms', '28 ms', '41 ms', '96 ms', '18 ms']);
    const widths = await wf.locator('.net-wf-seg').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(widths.every((w) => w > 0)).toBe(true);
    // The chain: two hops and where it ended.
    const rows = result.locator('[data-net-redirects] tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('http://x.example/');
    await expect(rows.nth(0)).toContainText('301');
    await expect(rows.nth(2)).toContainText('https://x.example/login');
    await expect(rows.nth(2)).toContainText('200');
    // Headers: the three that say most, the rest folded.
    const shown = result.locator('[data-net-headers] > table tr');
    await expect(shown.locator('.net-http-name')).toHaveText(['server', 'content-type', 'strict-transport-security']);
    await expect(result.locator('[data-net-headers] > b')).toHaveText('Headers (3 of 22)');
    const more = result.locator('.net-http-more');
    await expect(more).not.toHaveAttribute('open', '');
    await more.locator('summary').click();
    await expect(more.locator('tr').first()).toBeVisible();
    await expect(more).toContainText('set-cookie');
    await expect(more).toContainText('[hidden]');
    await expect(more).toContainText('4 more headers are not shown.');
    // A test names no host, port or path.
    expect(Object.keys(body).sort()).toEqual(['pageId', 'type', 'url']);
  });

  test('a failed run says what was expected and still shows the answer', async ({ page }) => {
    await page.route('**/api/net/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...httpOk, ok: false, class: 'http', error: 'The server answered 404; the check expects 200-299.', detail: '404',
        http: { ...httpOk.http, status: 404, redirects: [], timings: { ...httpOk.http.timings, redirectMs: 0 } },
      }),
    }));
    await open(page);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'HTTP' }).click();
    const result = net(page).locator('[data-tests-result="http"]');
    await expect(result).toHaveAttribute('data-state', 'down');
    const block = result.locator('[data-net-error-class="http"]');
    await expect(block).toContainText('Not the expected status');
    await expect(block).toContainText('The server answered 404; the check expects 200-299.');
    await expect(result.locator('[data-net-http-status]')).toHaveText('404');
    await expect(result.locator('[data-net-http-status]')).toHaveAttribute('data-state', 'down');
    await expect(result.locator('[data-net-redirects]')).toHaveCount(0);
  });

  test('a redirect the address guard refused is in the chain, marked, and points at the setting', async ({ page }) => {
    await page.route('**/api/net/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        type: 'http', ok: false, class: 'guard', ms: 30, host: 'x.example', port: 443, detail: '302 · redirect blocked',
        error: 'The server redirects to http://192.168.1.20/admin, which the address guard blocks: it resolves to 192.168.1.20, a private or reserved address.',
        http: {
          status: 302, url: 'http://192.168.1.20/admin',
          timings: { dnsMs: 4, connectMs: 6, tlsMs: 20, waitMs: 12, transferMs: 1, redirectMs: 0, ttfbMs: 30, totalMs: 31 },
          redirects: [{ url: 'https://x.example/', status: 302, ms: 30 }, { url: 'http://192.168.1.20/admin', blocked: true }],
        },
      }),
    }));
    await open(page);
    await net(page).locator('[data-net-run-types]').getByRole('button', { name: 'HTTP' }).click();
    const result = net(page).locator('[data-tests-result="http"]');
    const block = result.locator('[data-net-error-class="guard"]');
    await expect(block).toContainText('Redirect blocked by the address guard');
    await expect(block).toContainText('resolves to 192.168.1.20');
    await expect(block.getByRole('button', { name: /Allow localhost & private-network bookmarks/ })).toBeVisible();
    const rows = result.locator('[data-net-redirects] tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveClass(/is-blocked/);
    await expect(rows.nth(1)).toContainText('blocked');
  });

  test('a scheduled HTTP check shows its last answer and runs a test with the timeline', async ({ page }) => {
    await page.route('**/api/net/run', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(httpOk) }));
    await open(page, [{
      id: 'hhhhhhhhhhhh', type: 'http', enabled: true, display: 'HTTP', endpoint: '/health', expectStatus: '200',
      state: { at: Date.now(), ok: true, ms: 96, detail: '200 · 2 redirects' },
      stats: { uptime24h: { samples: 10, ratio: 1 }, heartbeat: [{ from: Date.now() - 60_000, state: 'up', avgMs: 90 }] },
    }]);
    const card = net(page).locator('[data-net-card]');
    await expect(card.locator('summary')).toContainText('HTTP');
    await expect(card.locator('summary .config-bm-acc-answer')).toHaveText('Up · 96 ms');
    await card.locator('summary').click();
    await expect(card).toContainText('200 · 2 redirects');
    await card.getByRole('button', { name: 'Test now' }).click();
    await expect(card.locator('[data-net-wf]')).toBeVisible();
    await expect(card.locator('[data-net-redirects] tr')).toHaveCount(3);
  });

  test('the form asks for a path, a status and a header, says what it does, and sends only those', async ({ page }) => {
    let put = null;
    await page.route('**/api/net/checks', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      put = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: put.checks.map((c, i) => ({ ...c, id: `00000000000${i}` })) }) });
    });
    await open(page);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('http');
    await expect(form.locator('[data-net-field="expectStatus"]')).toHaveAttribute('placeholder', '200-299');
    const explain = form.locator('[data-net-explain]');
    await expect(explain).toContainText('Down unless the final status is 200-299');
    await form.locator('[data-net-field="endpoint"]').fill('/health');
    await form.locator('[data-net-field="expectStatus"]').fill('200,204');
    await expect(explain).toContainText('Requests /health');
    await expect(explain).toContainText('final status is 200,204');
    // A path that names a host is refused before anything is sent.
    await form.locator('[data-net-field="endpoint"]').fill('//evil.example/x');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.locator('[data-net-field-wrap="endpoint"] .config-bm-field-status')).toContainText('single /');
    expect(put).toBeNull();
    await form.locator('[data-net-field="endpoint"]').fill('/health');
    await form.locator('[data-net-field="expectHeader"]').fill('server: nginx');
    await form.locator('[data-net-field="maxMs"]').fill('400');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => put).not.toBeNull();
    expect(put.checks).toHaveLength(1);
    expect(put.checks[0]).toMatchObject({ type: 'http', endpoint: '/health', expectStatus: '200,204', expectHeader: 'server: nginx', maxMs: 400, enabled: true });
    for (const key of ['port', 'count', 'record', 'minDaysLeft', 'host']) expect(put.checks[0]).not.toHaveProperty(key);
  });

  test('a failing scheduled check says which header was missing', async ({ page }) => {
    await open(page, [{
      id: 'iiiiiiiiiiii', type: 'http', enabled: true, display: 'HTTP', expectHeader: 'x-app: ok',
      state: { at: Date.now(), ok: false, ms: 50, class: 'content', detail: '200' },
      stats: { heartbeat: [{ from: Date.now() - 60_000, state: 'down', avgMs: 0 }], downSince: Date.now() - 600_000 },
    }]);
    const card = net(page).locator('[data-net-card]');
    await expect(card).toHaveAttribute('data-state', 'down');
    await card.locator('summary').click();
    const block = card.locator('[data-net-error-class="content"]');
    await expect(block).toContainText('Header not as expected');
    await expect(block).toContainText('x-app: ok');
  });
});
