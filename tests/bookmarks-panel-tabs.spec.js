const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The bookmark panel's tabs: Details, Health and Usage under a head that
 * always shows the name, score, address and actions.
 */

const panel = (page) => page.locator('#config-bm-panel');
const tab = (page, name) => panel(page).locator(`[data-bm-tab-panel="${name}"]`);
const pane = (page, name) => panel(page).locator(`[data-bm-pane="${name}"]`);

const open = (page, shape) => openBookmarksWithHealth(page, shape, { view: 'library' });

async function pick(page, name) {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
  await expect(panel(page).locator('.config-bm-panel-title')).toHaveText(name);
  await page.evaluate(() => document.activeElement?.blur?.());
}

test.describe('bookmark panel tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('nextdash.bm.panelTab'); } catch {} });
  });

  test('opens on Details, and a click switches tabs', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[1].name);
    await expect(tab(page, 'details')).toHaveAttribute('aria-selected', 'true');
    await expect(pane(page, 'details')).toBeVisible();
    await expect(pane(page, 'health')).toBeHidden();
    await tab(page, 'health').click();
    await expect(pane(page, 'health')).toBeVisible();
    await expect(pane(page, 'details')).toBeHidden();
  });

  test('1, 2 and 3 switch tabs, and the tab stays when the row changes', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[1].name);
    await page.keyboard.press('3');
    await expect(pane(page, 'usage')).toBeVisible();
    await pick(page, bookmarks[2].name);
    await expect(tab(page, 'usage')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('2');
    await expect(pane(page, 'health')).toBeVisible();
    // The digit went to the tab, not to the dashboard's page 2.
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
  });

  test('[ and ] step through the tabs', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[1].name);
    await page.keyboard.press(']');
    await expect(pane(page, 'health')).toBeVisible();
    await page.keyboard.press(']');
    await expect(pane(page, 'usage')).toBeVisible();
    await page.keyboard.press('[');
    await expect(pane(page, 'health')).toBeVisible();
  });

  test('with the side panel closed, 1 still goes to page 1', async ({ page }) => {
    await open(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('1');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
  });

  test('s opens the Health tab', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[0].name);
    await expect(panel(page).locator('.health-view-score-panel')).toBeAttached();
    await page.keyboard.press('s');
    await expect(pane(page, 'health')).toBeVisible();
  });

  test('a broken bookmark marks the Health tab, and its head carries the score', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[0].name);
    await expect(tab(page, 'health').locator('.config-bm-tab-dot')).toHaveCount(1);
    await expect(panel(page).locator('.config-bm-panel-head .config-bm-score')).toHaveText('25');
    await pick(page, bookmarks[2].name);
    await expect(tab(page, 'health').locator('.config-bm-tab-dot')).toHaveCount(0);
  });

  test('the ⋯ menu holds the rest of the actions', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[0].name);
    const menu = panel(page).locator('[data-bm-more-menu]');
    await expect(menu).toBeHidden();
    await panel(page).locator('[data-bm-more-toggle]').click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-bm-health-action="snooze"]')).toBeVisible();
    await expect(menu.locator('[data-bm-panel-action="delete"]')).toBeVisible();
  });

  test('several ticked rows get one form, no tabs', async ({ page }) => {
    await open(page);
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('j');
      await page.keyboard.press('x');
    }
    await expect(panel(page)).toHaveAttribute('data-bm-panel-mode', 'bulk');
    await expect(panel(page).locator('[data-bm-tab-panel]')).toHaveCount(0);
  });
});

test('a long address does not push the score out of the panel', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, (issues) => issues, {
    view: 'library',
    prepare: () => {
      const b = window.dashboardInstance.allBookmarks[0];
      b.url = `https://example.com/${'averyveryverylongpathsegmentwithoutanybreaks'.repeat(4)}`;
    },
  });
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
  const panel = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
  const score = panel.locator('.config-bm-panel-head .config-bm-score');
  await expect(score).toBeVisible();
  const [p, s] = [await panel.boundingBox(), await score.boundingBox()];
  expect(s.x + s.width).toBeLessThanOrEqual(p.x + p.width - 8);
  const head = await panel.locator('.config-bm-panel-head').boundingBox();
  expect(head.x + head.width).toBeLessThanOrEqual(p.x + p.width);
});

test('switching tabs keeps the head where it is', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
  const slab = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
  // The side panel keeps room for its scrollbar, so a tab long enough to
  // scroll does not narrow the head and tabs above it.
  expect(await slab.evaluate((el) => getComputedStyle(el).scrollbarGutter)).toBe('stable');
  const width = async () => (await slab.locator('.config-bm-tabs').boundingBox()).width;
  await slab.locator('[data-bm-tab-panel="details"]').click();
  const before = await width();
  await slab.locator('[data-bm-tab-panel="health"]').click();
  expect(await width()).toBe(before);
});

test('the tabs are equal and stay put while switching', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
  const slab = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
  const boxes = () => slab.locator('[data-bm-tab-panel]').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.width)];
  }));
  await slab.locator('[data-bm-tab-panel="details"]').click();
  const first = await boxes();
  expect(new Set(first.map(([, w]) => w)).size).toBe(1);
  for (const name of ['health', 'usage', 'details']) {
    await slab.locator(`[data-bm-tab-panel="${name}"]`).click();
    expect(await boxes()).toEqual(first);
  }
});

test('Open, Edit and Re-check sit on one row, without keycaps', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
  const actions = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .config-bm-panel-actions');
  const buttons = actions.locator(':scope > .config-btn');
  await expect(buttons).toHaveCount(3);
  await expect(buttons.nth(1)).toHaveText('Edit');
  const tops = await buttons.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(actions.locator('kbd')).toHaveCount(0);
  await expect(page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .config-bm-tabs kbd')).toHaveCount(0);
});

test('the head is set off from the tabs by room and a line', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) }).first().click();
  const slab = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
  const head = slab.locator('.config-bm-panel-head');
  expect(await head.evaluate((el) => getComputedStyle(el).borderBottomStyle)).toBe('solid');
  const buttons = await slab.locator('.config-bm-panel-actions').boundingBox();
  const tabs = await slab.locator('.config-bm-tabs').boundingBox();
  expect(tabs.y - (buttons.y + buttons.height)).toBeGreaterThanOrEqual(12);
});

test.describe('bookmark panel: scrolling stays in it', () => {
  const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');

  async function wheelOverDrawer(page) {
    const box = await drawer(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 600);
    // Wheel scrolling settles over a few frames.
    await page.waitForTimeout(300);
  }

  test('scrolling past the end of the panel leaves the list where it is', async ({ page }) => {
    const { bookmarks } = await open(page);
    // Short enough that the panel scrolls (the fixture sets its own size on load).
    await page.setViewportSize({ width: 1280, height: 520 });
    // Room for the page to scroll, whatever the shared data dir holds.
    await page.evaluate(() => { document.body.style.minHeight = '6000px'; });
    await pick(page, bookmarks[1].name);
    const before = await page.evaluate(() => window.scrollY);
    await wheelOverDrawer(page);
    expect(await drawer(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });

  test('a panel too short to scroll does not pass the wheel on either', async ({ page }) => {
    const { bookmarks } = await open(page);
    await page.evaluate(() => { document.body.style.minHeight = '6000px'; });
    await pick(page, bookmarks[1].name);
    // Only the head left: the panel has nothing to scroll.
    await drawer(page).evaluate((el) => el.querySelectorAll('[data-bm-pane], .config-bm-panel-tabs').forEach((n) => { n.style.display = 'none'; }));
    expect(await drawer(page).evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    const before = await page.evaluate(() => window.scrollY);
    await wheelOverDrawer(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
});
