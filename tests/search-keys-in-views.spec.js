const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const {
  markWhatsNewSeen, markHealthTutorialSeen, markInboxTutorialSeen, markConfigSettingPromosSeen, dismissBlockingOverlays,
} = require('./e2e-helpers');

/*
 * The search overlay's keys -- > : ? * and ! -- open from every view, not only
 * the bookmark grid. What is typed after them goes to the overlay, never to the
 * view's own single-key shortcuts underneath.
 */
const VIEWS = [
  { name: 'bookmarks', hash: '#1', ready: '.bookmark-link' },
  { name: 'health', hash: '#health', ready: '.health-layout' },
  { name: 'inbox', hash: '#inbox', ready: '.inbox-layout' },
  { name: 'config', hash: '#config', ready: '.config-layout' },
  { name: 'docker', hash: '#docker', ready: '[data-docker-row]' },
];

async function openView(page, view) {
  await markWhatsNewSeen(page);
  await markHealthTutorialSeen(page);
  await markInboxTutorialSeen(page);
  await markConfigSettingPromosSeen(page);
  await mockDocker(page);
  await page.goto('/' + view.hash);
  await page.waitForSelector(view.ready, { timeout: 20_000 });
  await dismissBlockingOverlays(page);
  // Nothing focused inside the view, the way a reader arrives with the mouse.
  await page.evaluate(() => document.activeElement?.blur?.());
}

const searchOpen = (page) => page.locator('#shortcut-search.show');
const query = (page) => page.locator('#search-query');

for (const view of VIEWS) {
  test.describe(`search keys in ${view.name}`, () => {
    test('> opens search and typing stays in it', async ({ page }) => {
      await openView(page, view);
      const hashBefore = await page.evaluate(() => location.hash);
      await page.keyboard.press('>');
      await expect(searchOpen(page)).toBeVisible();
      // The bundle may still be arriving; the existing search specs wait for
      // the rail the same way before typing.
      await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
      for (const ch of 'zqxw') await page.keyboard.press(ch);
      await expect(query(page)).toHaveText('zqxw');
      expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
      await page.keyboard.press('Escape');
      await expect(searchOpen(page)).toHaveCount(0);
      expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe(view.name);
    });

    // Every letter and digit typed into the overlay lands in it: a view
    // handler that took one (docker's r = restart, health's r = refresh)
    // would leave a gap in the query, or fire an action behind the overlay.
    test('no view shortcut fires while typing in search', async ({ page }) => {
      await openView(page, view);
      const posts = [];
      page.on('request', (req) => { if (req.method() !== 'GET') posts.push(`${req.method()} ${req.url()}`); });
      const hashBefore = await page.evaluate(() => location.hash);
      await page.keyboard.press('>');
      await page.waitForSelector('.search-scope-rail', { timeout: 20_000 });
      const typed = 'zqabcdefghijklmnopqrstuvwxyz0123456789';
      for (const ch of typed) await page.keyboard.press(ch);
      await expect(query(page)).toHaveText(typed);
      expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
      expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe(view.name === 'bookmarks' ? 'bookmarks' : view.name);
      expect(posts.filter((p) => !p.includes('/api/activity') && !p.includes('/api/telemetry') && !p.includes('/api/client'))).toEqual([]);
    });

    test(': opens the commands', async ({ page }) => {
      await openView(page, view);
      await page.keyboard.press(':');
      await expect(searchOpen(page)).toBeVisible();
      await expect(query(page)).toHaveText(':');
    });

    test('* opens recents', async ({ page }) => {
      await openView(page, view);
      await page.keyboard.press('*');
      await expect.poll(() => page.evaluate(() => window.dashboardInstance.isRecentBookmarksModalOpen?.() === true)).toBe(true);
    });

    test('! opens the shortcut sheet', async ({ page }) => {
      await openView(page, view);
      await page.keyboard.press('!');
      await expect(page.locator('#cheat-sheet-filter')).toBeVisible();
    });

    if (view.name !== 'health') {
      test('? opens the finders', async ({ page }) => {
        await openView(page, view);
        await page.keyboard.press('?');
        await expect(searchOpen(page)).toBeVisible();
        // The last finder used may be filled in after the prefix.
        await expect(query(page)).toHaveText(/^\?/);
      });
    }
  });
}
