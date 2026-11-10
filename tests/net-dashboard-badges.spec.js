// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Network checks on dashboard rows: chips in the row's tag cluster, problems
 * first, "+n" for what does not fit, never at the cost of the name.
 *
 * The bulk answer of GET /api/net/checks is stubbed for the real bookmarks of
 * the first page, so the state is not left to a real network. The setting is
 * changed the way a person does, in Config -> Monitoring -> Checks.
 */

const NOW = () => Date.now();

function item(bm, id, type, label, state, extra = {}) {
  const states = {
    ok: { at: NOW() - 60_000, ok: true, ms: 12 },
    down: { at: NOW() - 60_000, ok: false, class: 'refused' },
    warn: { at: NOW() - 60_000, ok: true, ms: 40, warn: true, detail: '9 days left' },
  };
  return {
    pageId: 1, url: bm.url, name: bm.name, checkId: id, type, label, enabled: true, muted: false, state: states[state], ...extra,
  };
}

async function open(page, makeItems) {
  await markWhatsNewSeen(page);
  const answer = { items: [], counts: {} };
  await page.route((url) => url.pathname === '/api/net/checks' && !url.search, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
  await prepareDashboardInteraction(page);
  const bms = await page.evaluate(() => window.dashboardInstance.bookmarks.slice(0, 6).map((b) => ({ name: b.name, url: b.url })));
  answer.items = makeItems(bms);
  // The next beat of the health badge, or Config's own read, brings it in; ask for it now.
  await page.evaluate(() => window.dashboardInstance.netBadges.refresh());
  return bms;
}

const rowOf = (page, bm) => page.locator('.bookmark-link', { has: page.locator('.bookmark-text', { hasText: new RegExp(`^${bm.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();

async function openedSpy(page) {
  await page.evaluate(() => {
    window.__opened = [];
    window.dashboardInstance.config.openLibraryOnBookmark = (...args) => { window.__opened.push(args); return Promise.resolve(); };
  });
}

async function setBadges(page, value) {
  await page.evaluate(() => {
    const c = window.dashboardInstance.config;
    c.monitoringTab = 'checks';
    return c.openConfigView('monitoring');
  });
  const select = page.locator('[data-behavior-field="netToolsDashboardBadges"]').first();
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.selectOption(value);
  await expect.poll(async () => (await page.evaluate(async () => (await (await fetch('/api/settings', { cache: 'no-store' })).json()).netToolsDashboardBadges))).toBe(value);
  await page.evaluate(() => { window.location.hash = '#1'; });
  await page.waitForSelector('.bookmark-link', { timeout: 10_000 });
}

test.afterEach(async ({ page }) => {
  // The settings live in the data folder the dev server shares: put them back.
  await page.evaluate(async () => {
    const current = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    await (window.nextDashFetch || fetch)('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, netToolsDashboardBadges: 'problems', showRowTags: false }),
    });
  }).catch(() => {});
});

test.describe('network checks on dashboard rows', () => {
  test('by default only a problem shows, and a healthy row is exactly what it was', async ({ page }) => {
    const bms = await open(page, (b) => [
      item(b[0], 'aaaaaaaaaaa1', 'tcp', 'TCP 443', 'down'),
      item(b[0], 'aaaaaaaaaaa2', 'ping', 'Ping', 'ok'),
      item(b[1], 'bbbbbbbbbbb1', 'tcp', 'TCP 443', 'ok'),
    ]);
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveCount(1);
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveText('TCP');
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveAttribute('data-state', 'down');
    // The healthy row has no cluster at all, and the same height as a row without checks.
    await expect(rowOf(page, bms[1]).locator('.bookmark-tag-strip')).toHaveCount(0);
    const heights = await page.evaluate(([a, b]) => [a, b].map((name) => [...document.querySelectorAll('.bookmark-link')]
      .find((r) => r.querySelector('.bookmark-text')?.textContent === name).getBoundingClientRect().height), [bms[1].name, bms[2].name]);
    expect(heights[0]).toBeCloseTo(heights[1], 1);
    // It says what it is, to the pointer and to a screen reader.
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveAttribute('aria-label', /TCP 443: Down/);
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveAttribute('title', /TCP 443: Down/);
  });

  test('the setting is changed in Config and takes effect without a reload', async ({ page }) => {
    const bms = await open(page, (b) => [
      item(b[0], 'aaaaaaaaaaa1', 'tcp', 'TCP 443', 'down'),
      item(b[1], 'bbbbbbbbbbb1', 'tcp', 'TCP 443', 'ok'),
    ]);
    await page.evaluate(() => { window.__still = 'here'; });
    await expect(page.locator('body')).toHaveAttribute('data-net-badges', 'problems');

    await setBadges(page, 'always');
    await expect(page.locator('body')).toHaveAttribute('data-net-badges', 'always');
    await expect(rowOf(page, bms[1]).locator('.bookmark-net-chip')).toHaveCount(1);
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveCount(1);

    await setBadges(page, 'never');
    await expect(page.locator('body')).toHaveAttribute('data-net-badges', 'never');
    await expect(page.locator('.bookmark-net-chip')).toHaveCount(0);

    await setBadges(page, 'problems');
    await expect(rowOf(page, bms[0]).locator('.bookmark-net-chip')).toHaveCount(1);
    await expect(rowOf(page, bms[1]).locator('.bookmark-net-chip')).toHaveCount(0);
    // The page was never reloaded.
    expect(await page.evaluate(() => window.__still)).toBe('here');
  });

  test('problems come first, more than fit become "+n", and the popover holds everything that did not fit', async ({ page }) => {
    const bms = await open(page, (b) => [
      item(b[0], 'aaaaaaaaaaa1', 'ping', 'Ping', 'ok'),
      item(b[0], 'aaaaaaaaaaa2', 'tls', 'TLS', 'warn'),
      item(b[0], 'aaaaaaaaaaa3', 'tcp', 'TCP 22', 'down'),
      item(b[0], 'aaaaaaaaaaa4', 'dns', 'DNS · MX', 'down'),
      item(b[0], 'aaaaaaaaaaa5', 'json', 'JSON · db', 'down'),
    ]);
    await page.evaluate(() => { window.dashboardInstance.settings.netToolsDashboardBadges = 'always'; });
    await page.evaluate(() => window.dashboardInstance.netBadges.paint());
    const row = rowOf(page, bms[0]);
    const chips = row.locator('.bookmark-net-chip');
    // Three fit with no tags: the three downs, ahead of the warning and the healthy check.
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveAttribute('data-state', 'down');
    await expect(chips.nth(2)).toHaveAttribute('data-state', 'down');
    const more = row.locator('[data-net-more]');
    await expect(more).toHaveText('+2');
    await expect(more).toHaveAttribute('title', /TLS: Warning[\s\S]*Ping: Up/);
    await openedSpy(page);
    await more.click();
    const pop = page.locator('.net-more-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('button')).toHaveText(['TLS', 'Ping']);
    // A check in it still leads to the bookmark's Tests tab.
    await pop.locator('button').first().click();
    await expect(pop).toHaveCount(0);
    expect(await page.evaluate(() => window.__opened)).toEqual([[1, bms[0].url, { tab: 'tests', focusRow: true }]]);
  });

  test('a click on a chip opens the bookmark on its Tests tab and not the bookmark itself', async ({ page }) => {
    const bms = await open(page, (b) => [item(b[2], 'cccccccccccc', 'tcp', 'TCP 443', 'down')]);
    await openedSpy(page);
    const popups = [];
    page.on('popup', (p) => popups.push(p));
    await rowOf(page, bms[2]).locator('.bookmark-net-chip').click();
    expect(await page.evaluate(() => window.__opened)).toEqual([[1, bms[2].url, { tab: 'tests', focusRow: true }]]);
    expect(popups).toHaveLength(0);
    expect(new URL(page.url()).hostname).toBe('localhost');
  });

  test('the name is never cut short by the chips: the cluster gives way first', async ({ page }) => {
    const bms = await open(page, (b) => [
      item(b[3], 'dddddddddddd', 'tcp', 'TCP 443', 'down'),
      item(b[3], 'dddddddddddf', 'dns', 'DNS · MX', 'down'),
      item(b[3], 'dddddddddddg', 'json', 'JSON · db', 'down'),
    ].map((i, n) => ({ ...i, checkId: `dddddddddd${n}0` })));
    const measured = await page.evaluate((name) => {
      const row = [...document.querySelectorAll('.bookmark-link')].find((r) => r.querySelector('.bookmark-text')?.textContent === name);
      const text = row.querySelector('.bookmark-text');
      const strip = row.querySelector('.bookmark-tag-strip');
      // Natural width of the name, then a row with room for the name and only a little more.
      const range = document.createRange();
      range.selectNodeContents(text);
      const natural = range.getBoundingClientRect().width;
      const link = row.querySelector('.bookmark-open');
      link.style.flex = 'none';
      link.style.width = `${natural + 40}px`;
      return {
        natural,
        name: text.getBoundingClientRect().width,
        nameScroll: range.getBoundingClientRect().width,
        strip: strip.getBoundingClientRect().width,
        stripContent: strip.scrollWidth,
      };
    }, bms[3].name);
    // The name kept every pixel it needs; the cluster is what ran out.
    // Exactly, not "about": a hundredth of a pixel short is already an ellipsis.
    expect(measured.name).toBeGreaterThanOrEqual(measured.natural);
    expect(measured.nameScroll).toBeLessThanOrEqual(measured.name);
    expect(measured.strip).toBeLessThan(measured.stripContent);
  });

  test('checks and tags share one cluster: problems first, then the tags, then +n', async ({ page }) => {
    const bms = await open(page, (b) => [item(b[4], 'eeeeeeeeeee1', 'ping', 'Ping', 'down')]);
    await page.evaluate((url) => {
      const d = window.dashboardInstance;
      d.settings.showRowTags = true;
      d.settings.rowTagsMax = 2;
      const bm = d.bookmarks.find((b) => b.url === url);
      bm.tags = ['alpha', 'beta', 'gamma'];
      document.querySelectorAll('.bookmark-link').forEach((row) => {
        if (row.dataset.bookmarkUrl === url) {
          d.bookmarkRows.populateBookmarkRowView(row, bm, row.dataset.categoryId, false);
        }
      });
    }, bms[4].url);
    const strip = rowOf(page, bms[4]).locator('.bookmark-tag-strip');
    await expect(strip.locator('.bookmark-tag-chip')).toHaveText(['Ping', 'alpha', 'beta', '+1']);
    await expect(strip.locator('.bookmark-tag-chip').first()).toHaveClass(/bookmark-net-chip/);
    await expect(strip.locator('[data-net-more]')).toHaveCount(0);
  });

  test('the row menu has a way to the checks for the keyboard', async ({ page }) => {
    const bms = await open(page, (b) => [item(b[0], 'ffffffffffff', 'tcp', 'TCP 443', 'down')]);
    await page.evaluate((url) => {
      const bm = window.dashboardInstance.bookmarks.find((b) => b.url === url);
      bm.checks = [{ id: 'ffffffffffff', type: 'tcp', enabled: true }];
    }, bms[0].url);
    await openedSpy(page);
    await rowOf(page, bms[0]).dispatchEvent('contextmenu', { clientX: 120, clientY: 160, bubbles: true });
    const entry = page.locator('.move-popover-item[data-action="net-checks"]');
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Network checks');
    await entry.click();
    expect(await page.evaluate(() => window.__opened)).toEqual([[1, bms[0].url, { tab: 'tests', focusRow: true }]]);
  });
});
