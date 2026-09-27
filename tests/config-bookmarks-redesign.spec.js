const { test, expect } = require('./fixtures');
const { openConfigBookmarks, bmRow } = require('./helpers/config-bookmarks');

test.describe('config bookmarks redesign: rows', () => {
  test('the row keeps title, domain, tags, opens and last opened; no check mode, added or dot', async ({ page }) => {
    await openConfigBookmarks(page);
    const row = bmRow(page);
    await expect(row.locator('.config-bm-title')).not.toBeEmpty();
    await expect(row.locator('.config-bm-domain')).toHaveCount(1);
    await expect(row.locator('.config-bm-tags')).toHaveCount(1);
    await expect(row.locator('.config-bm-opens')).toHaveCount(1);
    await expect(row.locator('.config-bm-last')).toHaveCount(1);
    await expect(row.locator('.config-bm-checkmode, .config-bm-added, .config-bm-health-dot')).toHaveCount(0);
  });

  test('the glow follows the health state', async ({ page }) => {
    await openConfigBookmarks(page);
    const status = await page.evaluate(() => {
      const cfg = window.dashboardInstance.config;
      const facts = window.HealthFacts;
      const orig = facts.get;
      const at = (bookmark, f) => { facts.get = () => f; return cfg.workbenchRowStatus(bookmark); };
      const checked = { url: 'https://example.com/x', checkStatus: true };
      const out = {
        healthy: at(checked, null),
        monitored: at(checked, { monitor: true }),
        broken: at(checked, { brokenSince: 1 }),
        down: at(checked, { monitor: true, downSince: 1 }),
        unchecked: at({ url: 'https://example.com/y' }, null),
      };
      facts.get = orig;
      return out;
    });
    // Nothing checks the last one: its own grey, not an absent colour that
    // would pass for a quiet healthy row.
    expect(status).toEqual({ healthy: 'good', monitored: 'info', broken: 'bad', down: 'warn', unchecked: 'off' });
  });

  test('the checkbox rests hidden and shows on hover', async ({ page }) => {
    await openConfigBookmarks(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    const tick = bmRow(page, 2).locator('.config-bm-tick-cell');
    await expect(tick).toBeHidden();
    await bmRow(page, 2).hover();
    await expect(tick).toBeVisible();
  });

  test('a row is as tall as a Health row', async ({ page }) => {
    await openConfigBookmarks(page);
    const h = await bmRow(page).evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(h).toBe(46);
  });
});

test.describe('config bookmarks redesign: rail and toolbar', () => {
  test('the search field sits in the toolbar and / focuses it', async ({ page }) => {
    await openConfigBookmarks(page);
    await expect(page.locator('.config-bm-toolbar #config-bm-search')).toHaveCount(1);
    await expect(page.locator('.config-bm-rail #config-bm-search')).toHaveCount(0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('/');
    await expect(page.locator('#config-bm-search')).toBeFocused();
  });

  test('the rail groups are not boxed, and the active filter is marked', async ({ page }) => {
    await openConfigBookmarks(page);
    const group = page.locator('.config-bm-rail-group').first();
    const box = await group.evaluate((el) => {
      const c = getComputedStyle(el);
      return { border: c.borderTopWidth, bg: c.backgroundColor };
    });
    expect(box.border).toBe('0px');
    expect(box.bg).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.config-bm-rail-item.is-on').first()).toBeVisible();
  });

  test('the List tab has no intro sentence', async ({ page }) => {
    await openConfigBookmarks(page);
    await expect(page.getByText('Every bookmark you have, from every page')).toHaveCount(0);
  });
});

test.describe('config bookmarks redesign: panel', () => {
  const { captureRowWrites } = require('./config-bookmarks-helpers');
  const section = (page, name) => page.locator(`#config-bm-panel [data-bm-section="${name}"]`);

  test('the panel has Details, Health and Usage tabs, the actions in its head, and the URL as a link', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.removeItem('nextdash.bm.panelTab'); } catch {} });
    await openConfigBookmarks(page);
    await bmRow(page, 1).click();
    for (const name of ['details', 'health', 'usage']) {
      await expect(page.locator(`#config-bm-panel [data-bm-tab-panel="${name}"]`)).toHaveCount(1);
    }
    await expect(section(page, 'edit').locator('[data-bm-field="name"]')).toBeVisible();
    await expect(page.locator('#config-bm-panel .config-bm-panel-head [data-bm-panel-action="open"]')).toBeVisible();
    await expect(page.locator('#config-bm-panel .config-bm-panel-head a[href^="http"]')).toHaveCount(1);
  });

  test('a live field still saves from inside its section', async ({ page }) => {
    const posts = await captureRowWrites(page);
    await openConfigBookmarks(page);
    await bmRow(page, 1).click();
    const note = section(page, 'edit').locator('[data-bm-field="note"]');
    await note.fill('from the edit section');
    await note.blur();
    await expect.poll(() => posts.some((list) => list.some((b) => b.note === 'from the edit section'))).toBe(true);
  });

  test('the panel reads as the shared slab', async ({ page }) => {
    await openConfigBookmarks(page);
    await bmRow(page, 1).click();
    const radius = await page.locator('#config-bm-panel').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    const drawerRadius = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'lvs-drawer';
      probe.style.position = 'absolute';
      document.body.appendChild(probe);
      const r = getComputedStyle(probe).borderTopLeftRadius;
      probe.remove();
      return r;
    });
    expect(radius).toBe(drawerRadius);
  });
});

test.describe('config bookmarks redesign: tag suggestions in the panel', () => {
  const { captureRowWrites } = require('./config-bookmarks-helpers');

  test('the Edit section offers the engine\'s tags, and taking one saves it', async ({ page }) => {
    const posts = await captureRowWrites(page);
    await openConfigBookmarks(page);
    // A predictable engine: the same call the bookmark form makes.
    await page.evaluate(() => {
      window.TagSuggestLive.forDraft = () => [{ tag: 'panel-offer', pattern: 'p', reason: { kind: 'rule' } }];
    });
    await bmRow(page, 1).click();
    const chip = page.locator('#config-bm-panel [data-bm-section="edit"] [data-bm-suggest] .tag-suggest-chip-add');
    await expect(chip).toHaveText('#panel-offer');
    await chip.click();
    await expect(page.locator('#config-bm-panel [data-bm-field="tags"]')).toHaveValue(/panel-offer/);
    await expect.poll(() => posts.some((list) => list.some((b) => (b.tags || []).includes('panel-offer')))).toBe(true);
  });
});

test.describe('config bookmarks redesign: suggestions for a selection', () => {
  test('two ticked rows get the tags their bookmarks share, and a chip fills the bulk tags field', async ({ page }) => {
    await openConfigBookmarks(page);
    // A predictable engine: one group covering both ticked rows, one covering
    // a single row, so the shared tag must come first.
    const keys = await Promise.all([1, 2].map((n) => bmRow(page, n).getAttribute('data-bm-key')));
    await page.evaluate((ks) => {
      window.TagSuggestions.suggest = () => [
        { tag: 'only-one', pattern: 'p2', keys: [ks[1]], reason: { kind: 'rule' } },
        { tag: 'shared-offer', pattern: 'p1', keys: ks, reason: { kind: 'rule' } },
      ];
    }, keys);
    for (const n of [1, 2]) {
      await bmRow(page, n).hover();
      await bmRow(page, n).locator('.config-bm-tick').check();
    }
    const chips = page.locator('#config-bm-panel [data-bm-bulk-suggest] .tag-suggest-chip-add');
    await expect(chips.first()).toHaveText('#shared-offer');
    await chips.first().click();
    await expect(page.locator('#config-bm-panel [data-bm-bulk-field="tags"]')).toHaveValue(/shared-offer/);
  });
});

test.describe('config bookmarks redesign: phone', () => {
  async function openAtPhone(page) {
    await page.setViewportSize({ width: 375, height: 812 });
    const { prepareDashboardInteraction } = require('./e2e-helpers');
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
  }

  test('the toolbar fits the screen', async ({ page }) => {
    await openAtPhone(page);
    const out = await page.evaluate(() => [...document.querySelectorAll('.config-bm-toolbar > *')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => { const r = el.getBoundingClientRect(); return { cls: el.className, left: Math.round(r.left), right: Math.round(r.right) }; })
      .filter((b) => b.left < 0 || b.right > window.innerWidth));
    expect(out).toEqual([]);
  });

  test('the panel sits above the section header', async ({ page }) => {
    await openAtPhone(page);
    await bmRow(page, 1).click();
    // On a phone the panel is a sheet, opened from the toolbar.
    await page.locator('[data-bm-open-drawer]').click();
    const name = page.locator('#config-bm-panel [data-bm-field="name"]');
    await expect(name).toBeVisible();
    const hit = await name.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
  });
});

test.describe('config bookmarks redesign: the panel fits', () => {
  test('a selected bookmark\'s panel fits on screen without needing its scrollbar', async ({ page }) => {
    await openConfigBookmarks(page);
    await bmRow(page, 1).click();
    await page.locator('#config-bm-panel [data-bm-tab-panel="details"]').click();
    await expect(page.locator('#config-bm-panel [data-bm-pane="details"]')).toBeVisible();
    const m = await page.locator('#config-bm-panel').evaluate((el) => ({
      bottom: Math.round(el.getBoundingClientRect().bottom),
      inner: window.innerHeight,
      overflowing: el.scrollHeight > el.clientHeight + 1,
    }));
    expect(m.overflowing).toBe(false);
    expect(m.bottom).toBeLessThanOrEqual(m.inner);
  });
});
