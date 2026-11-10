const { test, expect } = require('./fixtures');
const { useClassicType, WRITE_TOKEN } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Network checks in the Bookmarks view list: the small badges behind a
 * bookmark's name (scheduled checks only, three at most) and the rail's
 * "Check type" group, with its filter and its token. The checks are stored
 * through the API like the Health tab does; where the colour of a badge is
 * the point, the bulk answer is stubbed so the state is not left to a real
 * network.
 */

const rows = (page) => page.locator('#config-bm-list .config-bm-row');
const rowOf = (page, name) => rows(page).filter({ has: page.locator('.config-bm-title', { hasText: name }) });
const rail = (page) => page.locator('#config-bm-rail-facets');
const railItem = (page, label) => rail(page).locator('.config-bm-rail-item', { has: page.locator('.config-bm-rail-label', { hasText: new RegExp(`^${label}$`) }) });
const railCount = (page, label) => railItem(page, label).locator('.config-bm-rail-count');
const tokens = (page) => rail(page).locator('.config-bm-rail-token');

async function putChecks(page, bookmark, checks) {
  const res = await page.request.put('/api/net/checks', {
    data: { pageId: bookmark.pageId, url: bookmark.url, checks },
    headers: { 'X-NextDash-Token': WRITE_TOKEN },
  });
  expect(res.ok(), `PUT checks for ${bookmark.name}`).toBe(true);
}

const tcp = (port, extra = {}) => ({ type: 'tcp', enabled: true, port, ...extra });
const ping = (extra = {}) => ({ type: 'ping', enabled: true, ...extra });

/** The three bookmarks the specs share: [2] TCP + Ping, [3] Ping, [4] an unscheduled TCP. */
async function seed(page) {
  const { bookmarks } = await openBookmarksWithHealth(page);
  await putChecks(page, bookmarks[2], [tcp(8443), ping()]);
  await putChecks(page, bookmarks[3], [ping()]);
  await putChecks(page, bookmarks[4], [tcp(22, { enabled: false })]);
  return bookmarks;
}

/** Stub the bulk answer (the one without a query) with a state for each check. */
async function stubBulk(page, handler) {
  await page.route((url) => url.pathname === '/api/net/checks' && !url.search, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const real = await route.fetch();
    const body = await real.json();
    return route.fulfill({ response: real, json: handler(body) });
  });
}

test.beforeEach(async ({ page }) => {
  const reset = await page.request.post('/api/reset', { data: { confirm: true }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
  expect(reset.ok()).toBe(true);
  await useClassicType(page);
});

test.describe('network check badges and the Check type rail group', () => {
  test('a row carries a badge per scheduled check, and none for an unscheduled one', async ({ page }) => {
    const bookmarks = await seed(page);
    await openBookmarksWithHealth(page);
    const two = rowOf(page, bookmarks[2].name).first();
    await expect(two.locator('.net-tb')).toHaveText(['TCP', 'Ping']);
    await expect(rowOf(page, bookmarks[3].name).first().locator('.net-tb')).toHaveText(['Ping']);
    // Stored, but not scheduled: nothing to say about it behind the name.
    await expect(rowOf(page, bookmarks[4].name).first().locator('.net-tb')).toHaveCount(0);
    // A bookmark without checks has no badge element at all.
    await expect(rowOf(page, bookmarks[5].name).first().locator('[data-bm-nets]')).toHaveCount(0);
    // The badge says what it is when hovered (and to a screen reader).
    await expect(two.locator('.net-tb').first()).toHaveAttribute('aria-label', /TCP 8443: .+/);
  });

  test('more than three checks show three badges and "+n"', async ({ page }) => {
    const bookmarks = await seed(page);
    await putChecks(page, bookmarks[5], [tcp(80), tcp(443), ping(), tcp(22, { label: 'SSH' })]);
    await openBookmarksWithHealth(page);
    const badges = rowOf(page, bookmarks[5].name).first().locator('.net-tb');
    await expect(badges).toHaveCount(4);
    await expect(badges.last()).toHaveText('+1');
    await expect(badges.last()).toHaveAttribute('title', /.+/);
  });

  test('the rail counts bookmarks per type, the filter narrows the list and the token undoes it', async ({ page }) => {
    const bookmarks = await seed(page);
    await openBookmarksWithHealth(page);
    const total = await rows(page).count();
    expect(total).toBeGreaterThan(3);

    await expect(rail(page).locator('.config-bm-rail-title', { hasText: 'Check type' })).toBeVisible();
    await expect(railCount(page, 'Has checks')).toHaveText('3');
    await expect(railCount(page, 'TCP')).toHaveText('2');
    await expect(railCount(page, 'Ping')).toHaveText('2');
    await expect(railCount(page, 'Check down')).toHaveText('0');

    // Only the built types are offered.
    await expect(railItem(page, 'DNS')).toHaveCount(0);

    await railItem(page, 'TCP').click();
    await expect(tokens(page)).toHaveText(/Check type: TCP/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rowOf(page, bookmarks[2].name)).toHaveCount(1);
    await expect(rowOf(page, bookmarks[4].name)).toHaveCount(1);
    await expect(rowOf(page, bookmarks[3].name)).toHaveCount(0);

    await tokens(page).first().click();
    await expect(tokens(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(total);
  });

  test('Clear filters also lets go of the Check type', async ({ page }) => {
    await seed(page);
    await openBookmarksWithHealth(page);
    const total = await rows(page).count();
    await railItem(page, 'Ping').click();
    await expect(rows(page)).toHaveCount(2);
    await rail(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect(tokens(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(total);
  });

  test('a failing scheduled check colours its badge and fills "Check down"', async ({ page }) => {
    const bookmarks = await seed(page);
    const downId = { value: '' };
    await stubBulk(page, (body) => {
      body.items.forEach((item) => {
        if (item.pageId === bookmarks[2].pageId && item.url === bookmarks[2].url && item.type === 'tcp') {
          item.state = { at: Date.now(), ok: false, ms: 0, class: 'refused', detail: 'refused' };
          downId.value = item.checkId;
        } else if (item.enabled) {
          item.state = { at: Date.now(), ok: true, ms: 9 };
        }
      });
      return body;
    });
    await openBookmarksWithHealth(page);
    const badges = rowOf(page, bookmarks[2].name).first().locator('.net-tb');
    await expect(badges.nth(0)).toHaveAttribute('data-state', 'down');
    await expect(badges.nth(1)).toHaveAttribute('data-state', 'ok');
    expect(downId.value).not.toBe('');

    await expect(railCount(page, 'Check down')).toHaveText('1');
    await railItem(page, 'Check down').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, bookmarks[2].name)).toHaveCount(1);
  });

  test('the group is left out when the view setting leaves it out, and absent while no check exists', async ({ page }) => {
    // No checks anywhere: the rail looks as it did before.
    await openBookmarksWithHealth(page);
    await expect(rail(page).locator('.config-bm-rail-title', { hasText: 'Check type' })).toHaveCount(0);

    await seed(page);
    await openBookmarksWithHealth(page);
    await expect(rail(page).locator('.config-bm-rail-title', { hasText: 'Check type' })).toBeVisible();

    await useClassicType(page, { bmViewRailBlocks: ['views', 'health', 'pages', 'tags'] });
    await openBookmarksWithHealth(page);
    await expect(rail(page).locator('.config-bm-rail-title', { hasText: 'Health' })).toBeVisible();
    await expect(rail(page).locator('.config-bm-rail-title', { hasText: 'Check type' })).toHaveCount(0);
  });

  test('a new check shows up in the list without reloading it', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[3];
    await rowOf(page, target.name).first().click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('4');
    const net = page.locator('#config-bm-panel [data-bm-tests]');
    await net.getByRole('button', { name: 'Add check' }).click();
    const form = net.locator('[data-net-form]');
    await form.locator('[data-net-field="type"]').selectOption('tcp');
    await form.locator('[data-net-field="port"]').fill('9000');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(rowOf(page, target.name).first().locator('.net-tb')).toHaveText(['TCP']);
    await expect(railCount(page, 'TCP')).toHaveText('1');
  });
});
