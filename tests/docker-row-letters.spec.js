const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The Containers view speaks the same way as the dashboard, the Bookmarks view and
 * the Inbox: j/k move, d removes (it asks first), [ and ] flip the tabs, Shift+H
 * switches the legend, every menu action has a key, and the mode strip follows the
 * cursor (and hides for the mouse).
 */
async function openView(page) {
  await page.setViewportSize({ width: 1500, height: 900 });
  const state = await mockDocker(page);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  return state;
}
const selectedRow = (page) => page.locator('[data-docker-row].is-selected, [data-docker-row][aria-selected="true"]').first();

test('j and k move the row cursor like the arrows', async ({ page }) => {
  await openView(page);
  await page.keyboard.press('j');
  const first = await selectedRow(page).getAttribute('data-docker-row');
  await page.keyboard.press('j');
  const second = await selectedRow(page).getAttribute('data-docker-row');
  expect(second).not.toBe(first);
  await page.keyboard.press('k');
  expect(await selectedRow(page).getAttribute('data-docker-row')).toBe(first);
});

test('typed in the search box j and k are letters', async ({ page }) => {
  await openView(page);
  await page.locator('[data-docker-search]').focus();
  await page.keyboard.type('jk');
  await expect(page.locator('[data-docker-search]')).toHaveValue('jk');
});

test('d asks to remove the selected container, as Delete does', async ({ page }) => {
  await openView(page);
  await page.evaluate(() => {
    window.__removed = [];
    const a = window.dashboardInstance.docker.actions;
    a.removeOne = async (c, via) => { window.__removed.push(`${c.name}:${via}`); };
    a.canRemove = () => true;
  });
  await page.keyboard.press('j');
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => window.__removed.length)).toBe(1);
});

test('w and y reach the web UI and the copy of the ID', async ({ page }) => {
  await openView(page);
  await page.evaluate(() => {
    window.__acts = [];
    const m = window.dashboardInstance.docker.menu;
    const run = m.run.bind(m);
    m.run = async (id, c) => { window.__acts.push(id); };
    m.webuiFor = () => 'http://example.test/';
  });
  await page.keyboard.press('j');
  await page.keyboard.press('w');
  await page.keyboard.press('y');
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => window.__acts)).toEqual(['webui', 'copy-id', 'copy-name']);
});

test('the legend lists the new keys and Shift+H switches it', async ({ page }) => {
  await openView(page);
  const legend = page.locator('.docker-legend');
  await expect(legend).toBeVisible();
  for (const k of ['j / k', 'd', 'w', 'y', '[ / ]', 'Shift+H']) {
    await expect(legend.locator('kbd', { hasText: new RegExp(`^${k.replace(/[/+[\]]/g, '\\$&')}$`) })).toHaveCount(1);
  }
  await page.keyboard.press('Shift+H');
  await expect(page.locator('.docker-legend')).toHaveCount(0);
  await page.keyboard.press('Shift+H');
  await expect(page.locator('.docker-legend')).toBeVisible();
});

test('the row menu shows a key beside every action', async ({ page }) => {
  await openView(page);
  await page.locator('[data-docker-row]').first().click({ button: 'right' });
  const menu = page.locator('#docker-row-menu');
  await expect(menu).toBeVisible();
  const missing = await menu.locator('[data-docker-menu-action]').evaluateAll((els) => els
    .filter((el) => !el.querySelector('.move-popover-item-key')).map((el) => el.getAttribute('data-docker-menu-action')));
  expect(missing, 'menu entries without a key').toEqual([]);
});

test('the mode strip follows the cursor, hides for the mouse and returns with a key', async ({ page }) => {
  await openView(page);
  const strip = page.locator('#mode-strip');
  await expect(strip).toContainText('Browse');
  await page.keyboard.press('j');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('Cursor');
  await page.mouse.click(8, 8);
  await expect(strip).toBeHidden();
  await page.keyboard.press('j');
  await expect(strip).toBeVisible();
});

test('the legend is below the list by default, in view at the foot of the window', async ({ page }) => {
  await openView(page);
  const legend = page.locator('.docker-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toHaveClass(/is-below/);
  const table = await page.locator('[data-docker-row]').first().boundingBox();
  const box = await legend.boundingBox();
  expect(box.y).toBeGreaterThan(table.y);
});
