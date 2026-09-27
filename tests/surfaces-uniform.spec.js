const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Every modal, panel and menu is painted from one set of surface tokens, so
 * a theme's depth reaches all of them alike: solid where the theme is solid,
 * glass where it is glass. Menus never take a backdrop blur (a blurred menu
 * swallowed the clicks aimed at it, see dashboard.css).
 */

const TIERS = { modal: '--surface-modal-shadow', panel: '--surface-panel-shadow', menu: '--surface-menu-shadow' };

/** The surface's own paint against what the tokens resolve to right there. */
async function paint(locator, tier) {
  return locator.evaluate((el, shadowToken) => {
    const probe = document.createElement('div');
    probe.style.cssText = `background: var(--surface-float-bg); box-shadow: var(${shadowToken});
      border: 1px solid var(--surface-float-border); backdrop-filter: var(--surface-float-blur);`;
    document.body.appendChild(probe);
    const want = getComputedStyle(probe);
    const got = getComputedStyle(el);
    const pick = (cs) => ({
      bg: cs.backgroundColor, image: cs.backgroundImage, shadow: cs.boxShadow,
      // The side panel draws its rim as an outline, over a transparent
      // border it scrolls inside (list-view-shell.css).
      border: cs.outlineStyle !== 'none' && cs.borderTopColor === 'rgba(0, 0, 0, 0)' ? cs.outlineColor : cs.borderTopColor,
      filter: cs.backdropFilter,
    });
    const out = { got: pick(got), want: pick(want) };
    probe.remove();
    return out;
  }, TIERS[tier]);
}

async function surfaces(page) {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
  const row = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmarks[1].name }) }).first();
  const found = {};
  // The side panel.
  await row.click();
  found.panel = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
  await expect(found.panel).toBeVisible();
  // A row's menu.
  await row.click({ button: 'right' });
  found.menu = page.locator('#config-bm-context-menu');
  await expect(found.menu).toBeVisible();
  return found;
}

for (const depth of ['rich', 'glass']) {
  test(`under ${depth} depth, panels and menus share the modal's surface`, async ({ page }) => {
    await page.addInitScript((d) => {
      document.addEventListener('DOMContentLoaded', () => { document.body.dataset.depth = d; });
    }, depth);
    const found = await surfaces(page);
    await page.evaluate((d) => { document.body.dataset.depth = d; }, depth);
    for (const [tier, locator] of Object.entries(found)) {
      const { got, want } = await paint(locator, tier);
      expect(got.bg, `${tier} background`).toBe(want.bg);
      expect(got.image, `${tier} background image`).toBe(want.image);
      expect(got.shadow, `${tier} shadow`).toBe(want.shadow);
      expect(got.border, `${tier} border`).toBe(want.border);
      if (tier === 'menu') expect(got.filter, 'menus stay unblurred').toBe('none');
      else expect(got.filter, `${tier} blur`).toBe(want.filter);
    }
    if (depth === 'glass') {
      const { got } = await paint(found.panel, 'panel');
      expect(got.filter).toContain('blur');
    }
    // A modal on the same surface.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dashboardInstance.config.openBmHealthModal());
    const modal = page.locator('#app-modal.show .modal');
    await expect(modal).toBeVisible();
    const { got, want } = await paint(modal, 'modal');
    expect(got.bg).toBe(want.bg);
    expect(got.image).toBe(want.image);
    expect(got.shadow).toBe(want.shadow);
    expect(got.filter).toBe(want.filter);
  });
}
