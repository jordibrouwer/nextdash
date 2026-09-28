const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Two columns the Bookmarks view's width has room for: when a bookmark was
 * added, and how it has been opened over the last 30 days.
 */

const DAY = 86400000;

async function open(page) {
  return openBookmarksWithHealth(page, undefined, {
    view: 'library',
    prepare: () => {
      const now = Date.now();
      const [first, second] = window.dashboardInstance.allBookmarks;
      first.createdAt = new Date(2025, 6, 13).getTime();
      // Five opens today, one a fortnight ago.
      first.openLog = [...Array(5).fill(now - 3600_000), now - 14 * 86400000];
      second.openLog = [];
    },
  });
}

const row = (page, name) => page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first();

test.describe('bookmarks view: added and usage columns', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test('the date a bookmark was added closes its row, before the score', async ({ page }) => {
    const { bookmarks } = await open(page);
    const added = row(page, bookmarks[0].name).locator('.config-bm-added');
    await expect(added).toBeVisible();
    await expect(added).toContainText(/2025/);
    await expect(added).toHaveAttribute('title', /2025/);
  });

  test('thirty days of opens, drawn as bars, the recent ones on the right', async ({ page }) => {
    const { bookmarks } = await open(page);
    const spark = row(page, bookmarks[0].name).locator('.config-bm-spark');
    await expect(spark.locator('svg')).toBeVisible();
    await expect(spark).toHaveAttribute('title', /6/);
    const heights = await spark.locator('rect[data-count]').evaluateAll((rs) => rs.map((r) => Number(r.getAttribute('data-count'))));
    expect(heights.length).toBe(15);
    expect(heights[heights.length - 1]).toBe(5);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(6);
    // Nothing opened: the cell says so rather than drawing an empty chart.
    await expect(row(page, bookmarks[1].name).locator('.config-bm-spark')).toHaveAttribute('title', /no opens/i);
  });

  test('opening a bookmark shows in its bars at once', async ({ page }) => {
    const { bookmarks } = await open(page);
    await page.evaluate(() => { window.open = () => null; });
    const target = row(page, bookmarks[1].name);
    await expect(target.locator('.config-bm-spark')).toHaveAttribute('title', /no opens/i);
    await target.click();
    await page.locator('.lvs-drawer-host[data-lvs-drawer="library"] [data-bm-panel-action="open"]').first().click();
    await expect(target.locator('.config-bm-spark')).toHaveAttribute('title', /1 opens/);
  });

  test('a bookmark opened before the log was kept still shows that last open', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
      view: 'library',
      prepare: () => {
        const b = window.dashboardInstance.allBookmarks[2];
        b.openLog = [];
        b.lastOpened = Date.now() - 3 * 86400000;
      },
    });
    await expect(row(page, bookmarks[2].name).locator('.config-bm-spark')).toHaveAttribute('title', /1 opens/);
  });

  test('a narrower window keeps to the columns it had', async ({ page }) => {
    const { bookmarks } = await open(page);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(row(page, bookmarks[0].name).locator('.config-bm-added')).toBeHidden();
    await expect(row(page, bookmarks[0].name).locator('.config-bm-spark')).toBeHidden();
  });
});

test('tag chips stay whole inside their cell, whatever the width', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
    view: 'library',
    prepare: () => {
      window.dashboardInstance.allBookmarks.slice(0, 4).forEach((b) => { b.tags = ['social', 'humor', 'weblog', 'events']; });
    },
  });
  for (const width of [900, 1080, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(250);
    const spill = await page.locator('#config-bm-list .config-bm-row').evaluateAll((rows) => rows.flatMap((r) => {
      const cell = r.querySelector('.config-bm-tags');
      if (!cell) return [];
      const c = cell.getBoundingClientRect();
      return [...cell.querySelectorAll('.config-bm-tag:not([hidden])')]
        .filter((t) => { const b = t.getBoundingClientRect(); return b.left < c.left - 0.5 || b.right > c.right + 0.5; })
        .map((t) => t.textContent);
    }));
    expect(spill, `chips cut at ${width}px`).toEqual([]);
    // And at least one chip or its count is shown for a tagged bookmark.
    await expect(page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[0].name }) })
      .first().locator('.config-bm-tag:not([hidden])').first()).toBeVisible();
  }
});
