const { test, expect } = require('./fixtures');
const { useClassicType, WRITE_TOKEN } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Network checks in the Bookmarks view list: a row's scheduled checks are
 * chips in its tag cluster (problems first, then the tags, what does not fit
 * is "+n" with everything in a popover), and the rail's "Check type" group,
 * with its filter and its token. The checks are stored
 * through the API like the Health tab does; where the colour of a badge is
 * the point, the bulk answer is stubbed so the state is not left to a real
 * network.
 */

const rows = (page) => page.locator('#config-bm-list .config-bm-row');
const rowOf = (page, name) => rows(page).filter({ has: page.locator('.config-bm-title', { hasText: name }) });
const rail = (page) => page.locator('#config-bm-rail-facets');
const railItem = (page, label) => rail(page).locator('.config-bm-rail-item', { has: page.locator('.config-bm-rail-label', { hasText: new RegExp(`^${label}$`) }) });
const railCount = (page, label) => railItem(page, label).locator('.config-bm-rail-count');
/** The check chips a row shows (the hidden ones are in "+n"); the narrow-window copy beside the name is not visible here. */
const chips = (row) => row.locator('.config-bm-tag--net:visible');
const more = (row) => row.locator('.config-bm-tag--more:visible');
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
  test('a row carries a chip per scheduled check in its tag cluster, and none for an unscheduled one', async ({ page }) => {
    const bookmarks = await seed(page);
    await openBookmarksWithHealth(page);
    const two = rowOf(page, bookmarks[2].name).first();
    await expect(chips(two)).toHaveText(['TCP', 'Ping']);
    // They stand in the tags cell (the Tags column), not behind the name.
    await expect(two.locator('.config-bm-tags .config-bm-tag--net:visible')).toHaveCount(2);
    await expect(two.locator('.config-bm-name .config-bm-tag--net:visible')).toHaveCount(0);
    await expect(chips(rowOf(page, bookmarks[3].name).first())).toHaveText(['Ping']);
    // Stored, but not scheduled: nothing to say about it.
    await expect(rowOf(page, bookmarks[4].name).first().locator('.config-bm-tag--net')).toHaveCount(0);
    // A bookmark without checks has no chip element at all.
    await expect(rowOf(page, bookmarks[5].name).first().locator('.config-bm-tag--net, [data-bm-nets]')).toHaveCount(0);
    // The chip says what it is when hovered (and to a screen reader).
    await expect(chips(two).first()).toHaveAttribute('aria-label', /TCP 8443: .+/);
  });

  test('checks of one type read apart, and the "+n" says what it stands for', async ({ page }) => {
    const bookmarks = await seed(page);
    // Four checks, three of them TCP: the chips show their own labels, not "TCP" three times.
    await putChecks(page, bookmarks[5], [tcp(80), tcp(443), ping(), tcp(22, { label: 'SSH' })]);
    await openBookmarksWithHealth(page);
    const row = rowOf(page, bookmarks[5].name).first();
    const shown = await chips(row).allTextContents();
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.join(' ')).not.toMatch(/^TCP TCP/);
    // Whatever did not fit is "+n": the tags cell is narrower than four chips.
    const plus = more(row);
    await expect(plus).toHaveText(/^\+\d+$/);
    const hiddenCount = Number((await plus.textContent()).slice(1));
    await expect(plus).toHaveAttribute('aria-haspopup', 'dialog');
    // Label and tooltip name every hidden chip (checks and tags alike).
    const label = await plus.getAttribute('aria-label');
    expect(label.split(', ').length).toBe(hiddenCount);
    await expect(plus).toHaveAttribute('title', /.+/);
  });

  test('"+n" opens a popover with all the hidden items; a check in it opens that bookmark\'s Tests', async ({ page }) => {
    const bookmarks = await seed(page);
    await putChecks(page, bookmarks[5], [tcp(80), tcp(443), ping(), tcp(22, { label: 'SSH' })]);
    await openBookmarksWithHealth(page);
    const row = rowOf(page, bookmarks[5].name).first();
    const plus = more(row);
    const hiddenCount = Number((await plus.textContent()).slice(1));
    await plus.click();
    const pop = page.locator('.net-list-pop');
    await expect(pop).toBeVisible();
    await expect(pop).toHaveAttribute('role', 'dialog');
    await expect(pop.locator('.config-bm-tag')).toHaveCount(hiddenCount);
    // The click was the "+n"'s: the row was not selected and no panel opened.
    await expect(page.locator('#config-bm-list .keyboard-selected')).toHaveCount(0);
    await expect(page.locator('#config-bm-panel [data-bm-tests]')).toHaveCount(0);
    // Escape closes it and hands focus back to the "+n".
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(plus).toBeFocused();
    // A check in the popover goes to the Tests tab of this bookmark.
    await plus.click();
    const check = pop.locator('.config-bm-tag--net').first();
    if (await check.count() === 0) test.skip(true, 'every hidden item was a tag');
    await check.click();
    await expect(page.locator('#config-bm-panel [data-bm-tests]')).toBeVisible();
    await expect(page.locator('#config-bm-panel')).toContainText(bookmarks[5].name);
  });

  test('a click on a chip opens that bookmark\'s Tests tab', async ({ page }) => {
    const bookmarks = await seed(page);
    await openBookmarksWithHealth(page);
    const row = rowOf(page, bookmarks[3].name).first();
    await chips(row).first().click();
    await expect(page.locator('#config-bm-panel [data-bm-tests]')).toBeVisible();
    await expect(page.locator('#config-bm-panel')).toContainText(bookmarks[3].name);
  });

  test('a problem comes first in the cluster, ahead of the tags', async ({ page }) => {
    const bookmarks = await seed(page);
    // The second check (Ping) fails: it has to lead, though TCP is stored first.
    await stubBulk(page, (body) => {
      body.items.forEach((item) => {
        if (!item.enabled) return;
        const bad = item.pageId === bookmarks[2].pageId && item.url === bookmarks[2].url && item.type === 'ping';
        item.state = bad ? { at: Date.now(), ok: false, ms: 0, class: 'timeout', detail: 'timeout' } : { at: Date.now(), ok: true, ms: 9 };
      });
      return body;
    });
    await openBookmarksWithHealth(page);
    const row = rowOf(page, bookmarks[2].name).first();
    const kids = row.locator('.config-bm-tags > :visible');
    await expect(kids.first()).toHaveAttribute('data-net-chip', /.+/);
    await expect(kids.first()).toHaveAttribute('data-state', 'down');
    await expect(kids.first()).toHaveText('Ping');
    await expect(chips(row).nth(1)).toHaveAttribute('data-state', 'ok');
    // No tag sits ahead of a check.
    const order = await row.locator('.config-bm-tags').evaluate((cell) => {
      const all = [...cell.querySelectorAll('.config-bm-tag:not(.config-bm-tag--more)')].filter((el) => !el.hidden);
      const lastNet = all.map((el) => el.classList.contains('config-bm-tag--net')).lastIndexOf(true);
      const firstTag = all.findIndex((el) => !el.classList.contains('config-bm-tag--net'));
      return { lastNet, firstTag };
    });
    if (order.firstTag >= 0) expect(order.lastNet).toBeLessThan(order.firstTag);
  });

  test('the name is never cut short by the checks, with the Tags column on or off', async ({ page }) => {
    const bookmarks = await seed(page);
    await putChecks(page, bookmarks[5], [tcp(80), tcp(443), ping(), tcp(22, { label: 'SSH' })]);
    for (const columns of [null, ['opens', 'last', 'score']]) {
      await useClassicType(page, columns ? { bmViewColumns: columns } : {});
      await openBookmarksWithHealth(page);
      await page.setViewportSize({ width: 1000, height: 900 });
      for (const index of [2, 5]) {
        const row = rowOf(page, bookmarks[index].name).first();
        // Either a chip or the "+n" is there to say so; the room is what it is.
        await expect(row.locator('.config-bm-tag--net:visible, .config-bm-tag--more:visible').first()).toBeVisible();
        // The title is drawn whole: nothing of it is clipped.
        const cut = await row.locator('.config-bm-title').evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(cut, `${bookmarks[index].name}, columns ${JSON.stringify(columns)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('a failing check that does not fit tints the "+n"', async ({ page }) => {
    const bookmarks = await seed(page);
    await putChecks(page, bookmarks[5], [tcp(80), ping(), tcp(22, { label: 'Database primary' })]);
    await stubBulk(page, (body) => {
      body.items.forEach((item) => {
        if (!item.enabled) return;
        const bad = item.url === bookmarks[5].url && item.label === 'Database primary';
        item.state = bad ? { at: Date.now(), ok: false, ms: 0, class: 'refused', detail: 'refused' } : { at: Date.now(), ok: true, ms: 9 };
      });
      return body;
    });
    await openBookmarksWithHealth(page);
    await page.setViewportSize({ width: 1000, height: 900 });
    // At this width the cell holds one chip at most: the failing one leads, or is behind a red "+n".
    const row = rowOf(page, bookmarks[5].name).first();
    await expect(async () => {
      const state = await row.evaluate((r) => {
        const cell = r.querySelector('.config-bm-tags');
        const first = [...cell.querySelectorAll('.config-bm-tag--net')].find((c) => !c.hidden);
        const plus = cell.querySelector('.config-bm-tag--more:not([hidden])');
        return { first: first ? first.dataset.state : null, plus: plus ? plus.dataset.state || '' : null };
      });
      expect(state.first === 'down' || state.plus === 'down', JSON.stringify(state)).toBe(true);
    }).toPass();
  });

  test('without the Tags column the checks stand beside the name, with "+n" for what does not fit', async ({ page }) => {
    const bookmarks = await seed(page);
    await putChecks(page, bookmarks[5], [tcp(80), tcp(443), ping(), tcp(22, { label: 'SSH' })]);
    await useClassicType(page, { bmViewColumns: ['opens', 'last', 'score'] });
    await openBookmarksWithHealth(page);
    await page.setViewportSize({ width: 1000, height: 900 });
    const row = rowOf(page, bookmarks[5].name).first();
    await expect(row.locator('.config-bm-tags')).toHaveCount(0);
    await expect(row.locator('.config-bm-name .config-bm-tag--net:visible').first()).toBeVisible();
    // Nothing spills out of the name cell.
    const spill = await row.locator('.config-bm-nets').evaluate((el) => {
      const name = el.closest('.config-bm-name').getBoundingClientRect();
      return Math.max(...[...el.querySelectorAll('.config-bm-tag:not([hidden])')].map((c) => c.getBoundingClientRect().right - name.right));
    });
    expect(spill).toBeLessThanOrEqual(1);
    // And what is left out is in the "+n".
    const plus = more(row);
    if (await plus.count()) {
      await plus.click();
      await expect(page.locator('.net-list-pop .config-bm-tag').first()).toBeVisible();
    }
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

    // Only the built types are offered: DNS, TLS and HTTP are, with no check of them here; JSON is not yet.
    await expect(railCount(page, 'DNS')).toHaveText('0');
    await expect(railCount(page, 'TLS')).toHaveText('0');
    await expect(railCount(page, 'HTTP')).toHaveText('0');

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
    const badges = chips(rowOf(page, bookmarks[2].name).first());
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
    await expect(chips(rowOf(page, target.name).first())).toHaveText(['TCP']);
    await expect(railCount(page, 'TCP')).toHaveText('1');
  });
});
