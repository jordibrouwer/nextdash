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
    expect(status).toEqual({ healthy: 'good', monitored: 'info', broken: 'bad', down: 'warn', unchecked: null });
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

  test('the panel has Edit, Health, Usage and Actions sections, and the URL as a link', async ({ page }) => {
    await openConfigBookmarks(page);
    await bmRow(page, 1).click();
    for (const name of ['edit', 'health', 'usage', 'actions']) {
      await expect(section(page, name)).toHaveCount(1);
    }
    await expect(section(page, 'edit').locator('[data-bm-field="name"]')).toBeVisible();
    await expect(page.locator('#config-bm-panel .config-bm-panel-head a[href^="http"]')).toHaveCount(1);
  });

  test('a closed section stays closed on the next bookmark', async ({ page }) => {
    await openConfigBookmarks(page);
    await bmRow(page, 1).click();
    const health = section(page, 'health');
    if (await health.getAttribute('open') !== null) await health.locator('summary').click();
    await expect(health).not.toHaveAttribute('open', '');
    await bmRow(page, 2).click();
    await expect(section(page, 'health')).toHaveCount(1);
    await expect(section(page, 'health')).not.toHaveAttribute('open', '');
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
