const { test, expect } = require('./fixtures');

// The shared drawer on its own, driven from the page: it must remember its
// sections, go away completely, and give ScrollLock back on a phone.
test.describe('ListViewDrawer', () => {
  test('opens, remembers a section, closes', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.ListViewDrawer === 'function');
    // The view stylesheets load with a view; a drawer only exists inside one.
    await page.evaluate(() => window.ViewStyles?.ensureViewStyles?.());
    await page.evaluate(() => {
      try { localStorage.removeItem('nextdash.test.sections'); } catch {}
      window.__d = new window.ListViewDrawer({ id: 'test', storageKey: 'nextdash.test.sections', defaultSections: ['a'] });
      window.__d.mount();
      window.__d.open('k1', { title: 'One', build: (panel, ctx) => {
        ctx.section('a', 'Section A').textContent = 'alpha';
        ctx.section('b', 'Section B').textContent = 'beta';
      } });
    });
    const panel = page.locator('[data-lvs-drawer="test"] [data-lvs-drawer-panel]');
    await expect(panel).toContainText('One');
    await expect(panel.locator('[data-lvs-section="a"]')).toHaveAttribute('open', '');
    await panel.locator('[data-lvs-section="b"] summary').click();
    await page.evaluate(() => window.__d.close());
    await expect(panel).toHaveCount(0);
    await page.evaluate(() => window.__d.open('k2', { title: 'Two', build: (p, ctx) => { ctx.section('b', 'Section B'); } }));
    await expect(page.locator('[data-lvs-drawer="test"] [data-lvs-section="b"]')).toHaveAttribute('open', '');
    await page.evaluate(() => window.__d.destroy());
    await expect(page.locator('[data-lvs-drawer="test"]')).toHaveCount(0);
  });

  test('the close button closes it and says so', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.ListViewDrawer === 'function');
    // The view stylesheets load with a view; a drawer only exists inside one.
    await page.evaluate(() => window.ViewStyles?.ensureViewStyles?.());
    await page.evaluate(() => {
      window.__closed = 0;
      window.__d = new window.ListViewDrawer({ id: 'c', storageKey: 'nextdash.c.sections', onClose: () => { window.__closed += 1; } });
      window.__d.mount();
      window.__d.open('k', { title: 'X', build: () => {} });
    });
    await page.locator('[data-lvs-drawer="c"] .lvs-drawer-close').click();
    await expect(page.locator('[data-lvs-drawer="c"] [data-lvs-drawer-panel]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__closed)).toBe(1);
  });

  test('phone: fullscreen and ScrollLock released on close', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.ListViewDrawer === 'function');
    // The view stylesheets load with a view; a drawer only exists inside one.
    await page.evaluate(() => window.ViewStyles?.ensureViewStyles?.());
    const start = await page.evaluate(() => window.ScrollLock?.holders.size ?? 0);
    await page.evaluate(() => {
      window.__d = new window.ListViewDrawer({ id: 't2', storageKey: 'nextdash.t2.sections' });
      window.__d.mount();
      window.__d.open('k', { title: 'X', build: () => {} });
    });
    const box = await page.locator('[data-lvs-drawer="t2"] [data-lvs-drawer-panel]').boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBeGreaterThanOrEqual((await page.evaluate(() => innerWidth)) - 16);
    await page.evaluate(() => window.__d.close());
    expect(await page.evaluate(() => window.ScrollLock?.holders.size ?? 0)).toBe(start);
  });

  test('status glow comes from the shared attribute', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.ViewStyles?.ensureViewStyles?.());
    const shadow = await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('data-lvs-status', 'bad');
      document.body.appendChild(el);
      const s = getComputedStyle(el).boxShadow;
      el.remove();
      return s;
    });
    expect(shadow).not.toBe('none');
  });
});
