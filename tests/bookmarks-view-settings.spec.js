const { test, expect } = require('./fixtures');
const { openBookmarks, sidePanel } = require('./config-bookmarks-helpers');

/**
 * Config → Bookmarks → View takes effect in the Bookmarks view.
 *
 * The settings are served as the server would send them (the GET is answered
 * with them merged in), so each test reads them through the same load path the
 * app uses. A save from such a page is answered here and never stored: it
 * would carry the stand-in values into the shared data dir, and from there
 * into whichever test loads next.
 */
async function withSettings(page, values) {
  await page.route(/\/api\/settings(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: JSON.parse(route.request().postData() || '{}') });
    }
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, ...values } });
  });
}

async function open(page, values, width = 1400) {
  await page.setViewportSize({ width, height: 900 });
  if (values) await withSettings(page, values);
  await openBookmarks(page);
}

const row = (page, n = 0) => page.locator('#config-bm-list .config-bm-row').nth(n);
const drawerFrame = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer-frame');

test.describe('Bookmarks view: View settings, the list', () => {
  test('compact rows are shorter', async ({ page }) => {
    await open(page, { bmViewDensity: 'compact' });
    const h = await row(page).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h).toBe(36);
  });

  test('the address shows only the site, or not at all', async ({ page }) => {
    await open(page, { bmViewAddress: 'domain' });
    const texts = await page.locator('#config-bm-list .config-bm-domain').allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => t.includes('/'))).toEqual([]);
  });

  test('a hidden address leaves no domain line', async ({ page }) => {
    await open(page, { bmViewAddress: 'hidden' });
    await expect(page.locator('#config-bm-list .config-bm-domain')).toHaveCount(0);
  });

  test('rows without colours carry no status', async ({ page }) => {
    await open(page, { bmViewRowColors: false });
    await expect(page.locator('#config-bm-list .config-bm-row[data-lvs-status]')).toHaveCount(0);
  });

  test('only the chosen columns are drawn, each in a track of its own', async ({ page }) => {
    await open(page, { bmViewColumns: ['opens', 'added'] });
    const shape = await row(page).evaluate((el) => ({
      cells: [...el.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.className.split(' ').pop()),
      tracks: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    }));
    expect(shape.cells).toEqual(['config-bm-tick-cell', 'config-bm-icon-cell', 'config-bm-name', 'config-bm-opens', 'config-bm-added']);
    expect(shape.tracks).toBe(shape.cells.length);
  });

  test('every cell has its own track at the default columns too', async ({ page }) => {
    for (const width of [1400, 1150, 900]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 1400) await openBookmarks(page);
      const shape = await row(page).evaluate((el) => ({
        cells: [...el.children].filter((c) => getComputedStyle(c).display !== 'none').length,
        tracks: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      }));
      expect(shape.tracks, `at ${width}px`).toBe(shape.cells);
    }
  });

  test('usage covers seven days, a bar a day', async ({ page }) => {
    await open(page, { bmViewUsageDays: 7 });
    await expect(row(page).locator('.config-bm-spark rect')).toHaveCount(7);
  });

  test('the key legend can sit above the list, or go', async ({ page }) => {
    await open(page, { bmViewKeyLegend: 'above' });
    const above = await page.evaluate(() => {
      const legend = document.querySelector('#config-bm-list .config-bm-keyboard-legend');
      const list = document.querySelector('#config-bm-list .config-bm-feed');
      return Boolean(legend && list) && Boolean(legend.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(above).toBe(true);
  });

  test('the list opens on the group View sets', async ({ page }) => {
    await page.addInitScript(() => { try { Object.keys(localStorage).filter((k) => /group/i.test(k)).forEach((k) => localStorage.removeItem(k)); } catch {} });
    await open(page, { bmViewGroup: 'site' });
    await expect(page.locator('#config-bm-group')).toHaveValue('site');
  });
});

test.describe('Bookmarks view: View settings, the rail', () => {
  test('a folded rail waits behind the Filters button', async ({ page }) => {
    await open(page, { bmViewRail: 'folded' });
    await expect(page.locator('#config-bm-rail')).toBeHidden();
    await page.locator('[data-bm-open-sheet]').click();
    await expect(page.locator('#config-bm-rail')).toBeVisible();
  });

  test('blocks left out are not drawn', async ({ page }) => {
    await open(page, { bmViewRailBlocks: ['tags'] });
    const titles = await page.locator('#config-bm-rail .config-bm-rail-title').allTextContents();
    expect(titles.map((t) => t.trim())).toEqual(expect.arrayContaining([expect.stringMatching(/^Tags/)]));
    expect(titles.some((t) => /^(Views|Pages|Categories|Health)/.test(t.trim()))).toBe(false);
  });
});

test.describe('Bookmarks view: View settings, the side panel', () => {
  test('the panel opens on the tab View fixes, whatever was used last', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('nextdash.bm.panelTab', 'usage'); } catch {} });
    await open(page, { bmViewPanelTab: 'health' });
    await row(page, 1).click();
    await expect(page.locator('#config-bm-panel [data-bm-tab-panel="health"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('the panel can stay open on a click beside it', async ({ page }) => {
    await open(page, { bmViewCloseOutside: false });
    await row(page, 1).click();
    await expect(sidePanel(page)).toBeVisible();
    await page.locator('#config-bm-count').click();
    await expect(sidePanel(page)).toBeVisible();
  });

  test('the wide panel is wider', async ({ page }) => {
    await open(page, { bmViewPanelWidth: 'wide' });
    await row(page, 1).click();
    const w = await drawerFrame(page).evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(w).toBe(512);
  });
});

test.describe('Bookmarks view: View settings, clicking', () => {
  test('a click can only select the row', async ({ page }) => {
    await open(page, { bmViewClick: 'select' });
    await row(page, 1).click();
    await expect(row(page, 1)).toHaveClass(/keyboard-selected/);
    await page.waitForTimeout(300);
    await expect(sidePanel(page)).toHaveCount(0);
  });

  test('a double click can open the bookmark for editing', async ({ page }) => {
    await open(page, { bmViewDblClick: 'edit' });
    const before = page.url();
    await row(page, 1).locator('.config-bm-title').dblclick();
    await expect(page.locator('#config-bm-panel [data-bm-field="name"]')).toBeFocused();
    expect(page.url()).toBe(before);
  });

  test('health in large opens on the period View sets', async ({ page }) => {
    await open(page, { bmViewHealthRange: '7' });
    await row(page, 1).click();
    await page.keyboard.press('Shift+H');
    await expect(page.locator('[data-bm-large-range]')).toHaveValue('7');
  });
});

test('a View setting changed in Config reaches the view', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openBookmarks(page);
  await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
  await page.locator('[data-bm-tab="view"]').click();
  const density = page.locator('.config-bm-view-tab select[data-behavior-field="bmViewDensity"]');
  await density.selectOption('compact');
  try {
    await page.locator('.config-bm-view-tab [data-bm-open-view]').click();
    await page.waitForSelector('#config-bm-workbench #config-bm-list .config-bm-row', { timeout: 15_000 });
    const h = await row(page).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h).toBe(36);
  } finally {
    // Back to the default, so the shared data dir is left as found.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.locator('[data-bm-tab="view"]').click();
    await page.locator('.config-bm-view-tab select[data-behavior-field="bmViewDensity"]').selectOption('comfortable');
    await page.waitForTimeout(500);
  }
});
