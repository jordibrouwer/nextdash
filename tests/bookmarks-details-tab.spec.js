const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The panel's Details and Usage tabs in Health's layout: a summary on top,
 * the rest in an accordion. Details carries the address, the preview, the
 * local copies and removal beside the form; checking is Health's.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
const details = (page) => drawer(page).locator('[data-bm-pane="details"]');
const usage = (page) => drawer(page).locator('[data-bm-pane="usage"]');
const acc = (pane, name) => pane.locator(`[data-bm-acc="${name}"]`);

async function pick(page, name, tab = 'details') {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
  await drawer(page).locator(`[data-bm-tab-panel="${tab}"]`).click();
}

async function open(page, prepare) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('nextdash.bm.acc.details');
      localStorage.removeItem('nextdash.bm.acc.usage');
    } catch {}
  });
  return openBookmarksWithHealth(page, undefined, { view: 'library', prepare });
}

test.describe('bookmark panel: Details', () => {
  test('a summary of the preview and the facts on top, then the sections', async ({ page }) => {
    const { bookmarks } = await open(page, () => {
      const b = window.dashboardInstance.allBookmarks[1];
      b.previewTitle = 'A page title';
      b.previewDesc = 'What the page says about itself.';
      b.tags = ['alpha', 'beta'];
    });
    await pick(page, bookmarks[1].name);
    const viz = details(page).locator('.config-bm-details-viz');
    await expect(viz).toContainText('A page title');
    await expect(viz.locator('.config-bm-details-chip')).toContainText(['#alpha', '#beta']);
    for (const name of ['edit', 'address', 'preview', 'copies', 'remove']) await expect(acc(details(page), name)).toHaveCount(1);
    await expect(acc(details(page), 'edit')).toHaveAttribute('open', '');
    await expect(details(page).locator('[data-bm-field="name"]')).toBeVisible();
  });

  test('a preview stored with HTML entities reads as text', async ({ page }) => {
    const { bookmarks } = await open(page, () => {
      const b = window.dashboardInstance.allBookmarks[1];
      b.previewTitle = 'I&#039;m here &#8211; now';
      b.previewDesc = 'Fish &amp; chips';
    });
    await pick(page, bookmarks[1].name);
    const viz = details(page).locator('.config-bm-details-viz');
    await expect(viz.locator('.config-bm-details-title')).toHaveText('I\'m here \u2013 now');
    await expect(viz.locator('.config-bm-details-desc')).toHaveText('Fish & chips');
    await acc(details(page), 'preview').locator('summary').click();
    await expect(acc(details(page), 'preview')).toContainText('I\'m here \u2013 now');
  });

  test('what the server already knows of the preview fills in what the bookmark lacks', async ({ page }) => {
    const asked = [];
    await page.route('**/api/bookmark-preview?**', (route) => {
      asked.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Cached title', description: 'Cached description', image: '/data/preview-images/cached.png' }) });
    });
    const { bookmarks } = await open(page, () => {
      const [first, second] = window.dashboardInstance.allBookmarks;
      // Saved before the image was: title and text, but no picture.
      Object.assign(second, { previewTitle: 'Stored title', previewDesc: 'Stored', previewImage: '', previewEnriched: false });
      // Already answered for: nothing to ask.
      Object.assign(first, { previewTitle: 'Done', previewImage: '/data/preview-images/done.png', previewEnriched: true });
    });
    await pick(page, bookmarks[1].name);
    const preview = acc(details(page), 'preview');
    await preview.locator('summary').click();
    await expect(preview.locator('.config-bm-usage-kv', { hasText: 'Image' })).toContainText('yes');
    await expect(details(page).locator('.config-bm-details-viz img.config-bm-details-image')).toHaveAttribute('src', '/data/preview-images/cached.png');
    expect(asked.length).toBe(1);
    await pick(page, bookmarks[0].name);
    await expect(acc(details(page), 'preview').locator('.config-bm-usage-kv', { hasText: 'Image' })).toContainText('yes');
    expect(asked.length).toBe(1);
  });

  test('checking is Health\'s: no field in Details, a chip that leads there', async ({ page }) => {
    const { bookmarks } = await open(page);
    await pick(page, bookmarks[1].name);
    await expect(details(page).locator('[data-bm-field="checkMode"]')).toHaveCount(0);
    await details(page).locator('[data-bm-details-checking]').click();
    await expect(drawer(page).locator('[data-bm-pane="health"]')).toBeVisible();
    await expect(drawer(page).locator('[data-bm-acc="checking"]')).toHaveAttribute('open', '');
  });

  test('Address opens the bookmark in a new tab', async ({ page }) => {
    const { bookmarks } = await open(page);
    await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null; }; });
    await pick(page, bookmarks[1].name);
    await acc(details(page), 'address').locator('summary').click();
    await acc(details(page), 'address').locator('[data-bm-panel-action="open-new-tab"]').click();
    expect(await page.evaluate(() => window.__opened)).toEqual([bookmarks[1].url]);
  });

  test('Local copies lists the stored ones to read, and saves a new one', async ({ page }) => {
    const { bookmarks } = await open(page);
    await page.route('**/api/archives?url=**', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ captures: [{ url: '/archives/copy-1.html', at: Date.now() - 3600_000, size: 1_800_000 }] }),
    }));
    const captured = [];
    await page.route('**/api/archives/capture?**', (route) => {
      captured.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/archives/copy-2.html', at: Date.now() }) });
    });
    await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null; }; });
    await pick(page, bookmarks[1].name);
    const copies = acc(details(page), 'copies');
    await copies.locator('summary').click();
    await expect(copies.locator('[data-bm-copy-read]')).toHaveCount(1);
    await copies.locator('[data-bm-copy-read]').click();
    expect(await page.evaluate(() => window.__opened)).toEqual(['/archives/copy-1.html']);
    await copies.locator('[data-bm-copy-save]').click();
    await expect.poll(() => captured.length).toBe(1);
  });
});

test.describe('bookmark panel: Usage in the same layout', () => {
  test('the tiles and the weeks on top, the rest folded', async ({ page }) => {
    const { bookmarks } = await open(page, () => {
      const now = Date.now();
      window.dashboardInstance.allBookmarks[0].openCount = 9;
      window.dashboardInstance.allBookmarks[0].openLog = Array.from({ length: 9 }, (_, k) => now - k * 86400000);
    });
    await pick(page, bookmarks[0].name, 'usage');
    const viz = usage(page).locator('.config-bm-usage-viz');
    await expect(viz.locator('.config-bm-usage-tiles')).toContainText('9');
    await expect(viz.locator('svg.config-bm-usage-weeks')).toBeVisible();
    for (const name of ['life', 'compared', 'habits']) await expect(acc(usage(page), name)).toHaveCount(1);
  });
});
