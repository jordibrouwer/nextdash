const { test, expect } = require('./fixtures');
const { useClassicType } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The JSON check in the Tests tab: what the form asks for and sends, what a
 * test shows (the path, the value found and its type, what was expected, the
 * outcome) and how a failure reads. The server's answers are stubbed: what is
 * under test is how it is drawn and what is sent.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-tests]');

async function open(page, checks = []) {
  await page.route(/\/api\/net\/checks\?/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks }) });
  });
  await page.route('**/api/health/credentials', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ credentials: { 'svc:main': 'Service key' }, details: {} }) });
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

const jsonRun = {
  type: 'json', ok: false, ms: 84, class: 'content', host: 'x.example', port: 443, detail: 'degraded',
  error: 'The value at db.state is degraded, but the check expects ok.',
  json: { path: 'db.state', op: 'eq', expect: 'ok', found: true, value: 'degraded', type: 'string', ok: false, status: 200, ms: 84, size: 1200 },
};

const stored = (extra = {}) => ({
  id: 'jjjjjjjjjjjj', type: 'json', enabled: true, display: 'JSON · db.state', path: 'db.state', op: 'eq', expect: 'ok',
  state: { at: Date.now(), ok: true, ms: 84, detail: 'ok' },
  stats: { uptime24h: { samples: 10, ratio: 1 }, heartbeat: [{ from: Date.now() - 60_000, state: 'up', avgMs: 80 }] },
  ...extra,
});

test.beforeEach(async ({ page }) => {
  await useClassicType(page);
});

test.describe('JSON check in the Tests tab', () => {
  test('the form asks for a path, an operator and a value, explains itself and sends only those', async ({ page }) => {
    let put = null;
    await page.route('**/api/net/checks', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      put = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: put.checks.map((c, i) => ({ ...c, id: `00000000000${i}` })) }) });
    });
    await open(page);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('json');
    const explain = form.locator('[data-net-explain]');
    // Nothing is filled in yet: it says so instead of sending.
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.locator('[data-net-field-wrap="path"] .config-bm-field-status')).toContainText('Enter the path');
    await expect(form.locator('[data-net-field-wrap="expect"] .config-bm-field-status')).toContainText('Enter the value');
    expect(put).toBeNull();

    await form.locator('[data-net-field="path"]').fill('db.state');
    await form.locator('[data-net-field="expect"]').fill('ok');
    await expect(explain).toContainText('Up when the value at db.state is ok');
    await form.locator('[data-net-field="op"]').selectOption('gt');
    await form.locator('[data-net-field="expect"]').fill('many');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.locator('[data-net-field-wrap="expect"] .config-bm-field-status')).toContainText('enter a number');
    expect(put).toBeNull();
    await form.locator('[data-net-field="op"]').selectOption('exists');
    // "exists" has no value to compare with: the field goes.
    await expect(form.locator('[data-net-field="expect"]')).toHaveCount(0);
    await expect(explain).toContainText('Up when there is a value at db.state');
    await form.locator('[data-net-field="op"]').selectOption('contains');
    await form.locator('[data-net-field="expect"]').fill('ok');
    await form.locator('[data-net-field="endpoint"]').fill('/api/health');
    // The credential list holds the stored ones, never a value.
    await expect(form.locator('[data-net-field="credentialId"] option')).toHaveText(['None', 'Service key']);
    await form.locator('[data-net-field="credentialId"]').selectOption('svc:main');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => put).not.toBeNull();
    expect(put.checks).toHaveLength(1);
    expect(put.checks[0]).toMatchObject({ type: 'json', endpoint: '/api/health', path: 'db.state', op: 'contains', expect: 'ok', credentialId: 'svc:main', enabled: true });
    for (const key of ['port', 'count', 'record', 'minDaysLeft', 'host', 'expectStatus', 'expectHeader']) expect(put.checks[0]).not.toHaveProperty(key);
  });

  test('a secret-looking path says its value is never shown', async ({ page }) => {
    await open(page);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('json');
    await form.locator('[data-net-field="path"]').fill('auth.token');
    await expect(form.locator('[data-net-explain]')).toContainText('never shown or kept');
    await form.locator('[data-net-field="path"]').fill('db.state');
    await expect(form.locator('[data-net-explain]')).not.toContainText('never shown or kept');
  });

  test('Run once has no JSON button: it needs a path to look at', async ({ page }) => {
    await open(page);
    const buttons = net(page).locator('[data-net-run-types]').getByRole('button');
    await expect(buttons.filter({ hasText: 'HTTP' })).toHaveCount(1);
    await expect(buttons.filter({ hasText: 'JSON' })).toHaveCount(0);
  });

  test('Test first sends what the form says and shows the outcome, without a host or a port', async ({ page }) => {
    let body = null;
    await page.route('**/api/net/run', (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...jsonRun, ok: true, class: undefined, error: undefined, detail: 'ok', json: { ...jsonRun.json, value: 'ok', ok: true } }) });
    });
    await open(page);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('json');
    // Incomplete: the test is refused before anything is sent.
    await form.getByRole('button', { name: 'Test first' }).click();
    await expect(form.locator('[data-net-test]')).toContainText('Enter the path');
    expect(body).toBeNull();
    await form.locator('[data-net-field="path"]').fill('db.state');
    await form.locator('[data-net-field="expect"]').fill('ok');
    await form.locator('[data-net-field="credentialId"]').selectOption('svc:main');
    await form.getByRole('button', { name: 'Test first' }).click();
    await expect(form.locator('[data-net-test-result]')).toContainText('Up');
    await expect(form.locator('[data-net-test-summary]')).toContainText('db.state is ok');
    expect(body).toMatchObject({ type: 'json', path: 'db.state', op: 'eq', expect: 'ok', credentialId: 'svc:main' });
    for (const key of ['host', 'port', 'checkId']) expect(body).not.toHaveProperty(key);
  });

  test('a scheduled JSON check shows its last value and a test with the path, the value found and what was expected', async ({ page }) => {
    await page.route('**/api/net/run', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...jsonRun, ok: true, class: undefined, error: undefined, detail: 'ok', json: { ...jsonRun.json, value: 'ok', ok: true } }) }));
    await open(page, [stored()]);
    const card = net(page).locator('[data-net-card]');
    await expect(card.locator('summary')).toContainText('JSON · db.state');
    await expect(card.locator('summary .config-bm-acc-answer')).toHaveText('Up · 84 ms');
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Test now' }).click();
    const rows = card.locator('[data-net-json-rows]');
    await expect(card.locator('[data-net-json-outcome]')).toHaveText('Meets the check');
    await expect(card.locator('[data-net-json-outcome]')).toHaveAttribute('data-state', 'ok');
    await expect(card.locator('[data-net-json-status]')).toHaveText('200');
    await expect(rows.locator('[data-net-json-path]')).toContainText('db.state');
    await expect(rows.locator('[data-net-json-found]')).toContainText('ok (string)');
    await expect(rows.locator('[data-net-json-expected]')).toContainText('is ok');
    await expect(card.locator('[data-net-json-chips]')).toContainText('1.2 KB');
  });

  test('a failing JSON check says what was found and what was expected', async ({ page }) => {
    await open(page, [stored({
      state: { at: Date.now(), ok: false, ms: 84, class: 'content', detail: 'degraded' },
      stats: { heartbeat: [{ from: Date.now() - 60_000, state: 'down', avgMs: 0 }], downSince: Date.now() - 600_000 },
    })]);
    const card = net(page).locator('[data-net-card]');
    await card.locator('summary').click();
    const block = card.locator('[data-net-error-class="content"]');
    await expect(block).toContainText('Not the expected value');
    await expect(block).toContainText('The value at db.state is degraded, but the check expects it is ok.');
  });

  test('a failing test and the last result do not quote a secret value', async ({ page }) => {
    await page.route('**/api/net/run', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...jsonRun, detail: '[hidden]', error: 'The value at auth.token is not what the check expects.',
        json: { ...jsonRun.json, path: 'auth.token', expect: '[hidden]', value: '[hidden]' },
      }),
    }));
    await open(page, [stored({
      path: 'auth.token', expect: 'abc',
      state: { at: Date.now(), ok: false, ms: 84, class: 'content', detail: '[hidden]' },
      stats: { heartbeat: [{ from: Date.now() - 60_000, state: 'down', avgMs: 0 }], downSince: Date.now() - 600_000 },
    })]);
    const card = net(page).locator('[data-net-card]');
    await card.locator('summary').click();
    // The last result says it without quoting the value.
    await expect(card.locator('[data-net-error-class="content"]')).toContainText('The value at auth.token is not what the check expects.');
    await card.getByRole('button', { name: 'Test now' }).click();
    await expect(card.locator('[data-net-json-outcome]')).toHaveAttribute('data-state', 'down');
    await expect(card.locator('[data-net-json-outcome]')).toHaveText('Does not meet it');
    await expect(card.locator('[data-net-json-found]')).toContainText('[hidden] (string)');
    await expect(card.locator('[data-net-json-expected]')).toContainText('[hidden]');
    await expect(card).not.toContainText('degraded');
    await expect(card.locator('[data-net-error-class="content"]')).not.toContainText('degraded');
  });

  test('an answer that is not JSON and an answer that is not a success are told apart', async ({ page }) => {
    const answers = [
      { class: 'content', detail: 'not JSON', error: 'That address answered with a web page, not JSON — check the path.', json: { path: 'db.state', op: 'eq', expect: 'ok', found: false, ok: false, status: 200, ms: 40, size: 800 } },
      { class: 'http', detail: '401', error: 'The server answered 401; this check needs a 2xx answer. Check the credential.', json: { path: 'db.state', op: 'eq', expect: 'ok', found: false, ok: false, status: 401, ms: 40 } },
    ];
    let n = 0;
    await page.route('**/api/net/run', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...jsonRun, ...answers[n++ % 2] }) }));
    await open(page, [stored({ state: undefined })]);
    const card = net(page).locator('[data-net-card]');
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Test now' }).click();
    await expect(card).toContainText('The answer is not JSON');
    await expect(card.locator('[data-net-json-found]')).toContainText('nothing at this path');
    await expect(card.locator('[data-net-json-outcome]')).toHaveAttribute('data-state', 'down');
    await card.getByRole('button', { name: 'Test now' }).click();
    await expect(card).toContainText('The answer is not a success');
    await expect(card.locator('[data-net-json-status]')).toHaveText('401');
    await expect(card.locator('[data-net-json-found]')).toHaveCount(0);
  });
});
