const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Structure → Categories, Pages and Finders read like the list views' rows: one
 * line each, touching, the name as text until you reach for it, the buttons dim
 * until the row is hovered or focused.
 */

async function openStructure(page, tab) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
  await prepareDashboardInteraction(page);
  await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
  if (tab !== 'categories') {
    const label = tab === 'finders' ? 'Finders' : 'Pages';
    await page.locator('#config-view-body').getByText(label, { exact: true }).first().click();
  }
  await page.waitForSelector(`.config-crud-list--table .config-crud-row`, { timeout: 15_000 });
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur?.());
}

for (const [tab, nameSel] of [['categories', '[data-cat="name"]'], ['pages', '[data-page="name"]'], ['finders', '[data-finder="name"]']]) {
  test.describe(`structure ${tab} as a table`, () => {
    test('a row is 38px tall, and rows touch', async ({ page }) => {
      await openStructure(page, tab);
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.config-crud-list--table .config-crud-row')];
        const a = rows[0].getBoundingClientRect();
        const b = rows[1]?.getBoundingClientRect();
        return { h: Math.round(a.height), gap: b ? Math.round(b.top - a.bottom) : 0 };
      });
      expect(m.h).toBe(38);
      expect(m.gap).toBe(0);
    });

    test('the name reads as text at rest', async ({ page }) => {
      await openStructure(page, tab);
      const name = page.locator(`.config-crud-list--table .config-crud-row ${nameSel}`).first();
      const s = await name.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, bg: getComputedStyle(el).backgroundColor, fw: getComputedStyle(el).fontWeight }));
      expect(s.bg).toBe('rgba(0, 0, 0, 0)');
      expect(s.fw).toBe('600');
    });

    test('the buttons are dim at rest and full on hover', async ({ page }) => {
      await openStructure(page, tab);
      const row = page.locator('.config-crud-list--table .config-crud-row').first();
      const actions = row.locator('.config-crud-row-actions');
      await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.45');
      await row.hover();
      await expect.poll(() => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    });
  });
}

/**
 * The four Structure tabs in the list-view look of Bookmarks, Inbox and
 * Containers: a summary line, small-caps column heads, rows without boxes.
 */
async function openTab(page, tab) {
  await page.locator(`#config-view-body [data-pt-tab="${tab}"]`).click();
  const body = page.locator('#config-pt-body');
  await expect(body.locator('.structure-summary').first()).toBeVisible();
  await expect(body.locator('.structure-colhead').first()).toBeVisible();
  return body;
}

test.describe('structure tabs in the list-view look', () => {
  test('each tab has a summary line and column heads, no bars, transparent rows', async ({ page }) => {
    await openStructure(page, 'categories');
    // A custom collection to draw a row for (display only, nothing is saved).
    await page.evaluate(() => {
      const d = window.dashboardInstance;
      d.settings.collections = [{ id: 'col-spec', name: 'Spec collection', icon: '', logic: 'and', rules: [{ field: 'tag', operator: 'includes', value: 'work' }] }];
    });
    for (const tab of ['categories', 'pages', 'finders', 'collections']) {
      const body = await openTab(page, tab);
      await expect(body.locator('.config-stat-bar')).toHaveCount(0);
      const bg = await body.locator('.config-crud-row').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent').toBe(true);
    }
  });

  test('the sub-tabs sit at the top of the content column, beside the Config sections list', async ({ page }) => {
    await openStructure(page, 'categories');
    const m = await page.evaluate(() => {
      const top = (sel) => document.querySelector(sel).getBoundingClientRect();
      return { tabs: top('#config-view-body .config-subtabs'), nav: top('#config-nav-heading'), body: top('#config-view-body') };
    });
    // To the right of the list of sections, not below it...
    expect(m.tabs.left).toBeGreaterThan(m.nav.right - 1);
    // ...and at its height: only the one-sentence intro stands above the strip.
    expect(Math.abs(m.tabs.top - m.nav.top)).toBeLessThanOrEqual(32);
    expect(m.tabs.top - m.body.top).toBeLessThanOrEqual(32);
  });

  test('a collection of flag rules shows its real count, and its rules in words', async ({ page }) => {
    await openStructure(page, 'categories');
    const pinned = await page.evaluate(() => {
      const d = window.dashboardInstance;
      d.allBookmarks.slice(0, 2).forEach((b) => { b.pinned = true; });
      d.allBookmarks.slice(2).forEach((b) => { b.pinned = false; });
      d.settings.collections = [
        { id: 'col-pin', name: 'Pinned only', icon: '', logic: 'and', rules: [{ field: 'pinned', operator: 'includes', value: '' }] },
        { id: 'col-or', name: 'Either', icon: '', logic: 'or', rules: [{ field: 'pinned', operator: 'includes', value: '' }, { field: 'notOpenedDays', operator: 'includes', value: '90' }] },
      ];
      return d.allBookmarks.filter((b) => b.pinned).length;
    });
    expect(pinned).toBeGreaterThan(0);
    await page.locator('#config-view-body [data-pt-tab="collections"]').click();
    const row = page.locator('[data-collection-row="col-pin"]');
    await expect(row.locator('.structure-num')).toHaveText(String(pinned));
    await expect(row.locator('.structure-muted')).toHaveText('Pinned');
    await expect(page.locator('[data-collection-row="col-or"] .structure-muted')).toHaveText('Pinned or not opened in 90 days');
    await expect(page.locator('.structure-summary').last()).toContainText('collections');
  });

  test('the collection being edited keeps its accent', async ({ page }) => {
    await openStructure(page, 'categories');
    await page.evaluate(() => {
      window.dashboardInstance.settings.collections = [{ id: 'col-a', name: 'A', icon: '', logic: 'and', rules: [{ field: 'tag', operator: 'includes', value: 'x' }] }];
    });
    await page.locator('#config-view-body [data-pt-tab="collections"]').click();
    await page.locator('[data-collection-edit="col-a"]').click();
    const row = page.locator('[data-collection-row="col-a"]');
    await expect(row).toHaveClass(/is-active/);
    const m = await row.evaluate((el) => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--accent-primary)';
      document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(el);
      return { accent, border: cs.borderBottomColor, shadow: cs.boxShadow };
    });
    expect(m.border).toBe(m.accent);
    expect(m.shadow).toContain(m.accent);
  });

  for (const tab of ['categories', 'pages', 'finders', 'collections']) {
    test(`${tab}: the column heads line up with the row cells`, async ({ page }) => {
      await openStructure(page, 'categories');
      await page.evaluate(() => {
        window.dashboardInstance.settings.collections = [{ id: 'col-spec', name: 'Spec collection', icon: '', logic: 'and', rules: [{ field: 'tag', operator: 'includes', value: 'work' }] }];
      });
      const body = await openTab(page, tab);
      await body.locator('.config-crud-row').first().waitFor();
      const drift = await page.evaluate(() => {
        const flat = (row) => [...row.children].flatMap((c) => (getComputedStyle(c).display === 'contents' ? [...c.children] : [c]))
          .filter((c) => !c.classList.contains('config-field-warning'));
        const head = document.querySelector('#config-pt-body .structure-colhead');
        const row = document.querySelector('#config-pt-body .config-crud-row');
        const heads = [...head.children];
        const cells = flat(row);
        if (heads.length !== cells.length) return { count: [heads.length, cells.length] };
        // Numbers are right-aligned, the rest left-aligned: compare the edge the text sits on.
        return heads.map((h, i) => {
          const a = h.getBoundingClientRect();
          const b = cells[i].getBoundingClientRect();
          const right = h.classList.contains('structure-num');
          return Math.round(Math.abs(right ? a.right - b.right : a.left - b.left));
        });
      });
      expect(drift.count).toBeUndefined();
      for (const px of drift) expect(px).toBeLessThanOrEqual(1);
      // A head is read whole: none runs into its neighbour.
      const clipped = await page.evaluate(() => [...document.querySelectorAll('#config-pt-body .structure-colhead > *')]
        .filter((h) => h.scrollWidth > h.clientWidth + 1).map((h) => h.textContent));
      expect(clipped).toEqual([]);
    });
  }

  test('the summary says "1 finder", not "1 finders"', async ({ page }) => {
    await openStructure(page, 'finders');
    await page.evaluate(() => {
      const c = window.dashboardInstance.config;
      c._finders = [{ name: 'One', searchUrl: 'https://example.com/?q=%s', shortcut: 'o' }];
      c.repaintPtBody();
    });
    await expect(page.locator('#config-pt-body .structure-summary')).toContainText('1 finder');
    await expect(page.locator('#config-pt-body .structure-summary')).not.toContainText('1 finders');
  });
});
