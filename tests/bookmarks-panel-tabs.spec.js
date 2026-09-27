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
