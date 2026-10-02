const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/** The settings the page saved last, as the server received them. */
async function trackSettings(page) {
  const saved = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/settings') {
      try { saved.push(JSON.parse(req.postData() || '{}')); } catch { /* not JSON */ }
    }
  });
  return saved;
}

test.describe('docker notifications', () => {
  test('mute from the row menu, then from the drawer again; Details says which', async ({ page }) => {
    await mockDocker(page);
    const saved = await trackSettings(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);

    await page.locator('[data-docker-row="jellyfin"]').click({ button: 'right' });
    const mute = page.locator('#docker-row-menu [data-docker-menu-action="mute"]');
    await expect(mute).toContainText('Mute notifications');
    await mute.click();
    await expect.poll(() => saved.at(-1)?.dockerNotifyMuted).toEqual(['jellyfin']);

    await page.locator('[data-docker-row="jellyfin"]').click({ button: 'right' });
    await expect(page.locator('#docker-row-menu [data-docker-menu-action="mute"]')).toContainText('Unmute notifications');
    await page.keyboard.press('Escape');

    await page.locator('[data-docker-row="jellyfin"]').click();
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer.locator('[data-docker-notify-state]')).toHaveText('muted');
    await drawer.locator('[data-slp-more]').click();
    await drawer.locator('[data-slp-action="mute"]').click();
    await expect.poll(() => saved.at(-1)?.dockerNotifyMuted).toEqual([]);
    await expect(drawer.locator('[data-docker-notify-state]')).toHaveText('on');
  });

  test('a mute the server refuses is not kept, and says nothing of success', async ({ page }) => {
    await mockDocker(page);
    const saved = await trackSettings(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.route('**/api/settings', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 500, body: 'no' })
      : route.continue()));

    await page.locator('[data-docker-row="jellyfin"]').click({ button: 'right' });
    await page.locator('#docker-row-menu [data-docker-menu-action="mute"]').click();
    await expect.poll(() => saved.some((s) => (s.dockerNotifyMuted || []).includes('jellyfin'))).toBe(true);
    await expect(page.locator('#app-notification.show')).not.toContainText('No more notices');
    await page.locator('[data-docker-row="jellyfin"]').click({ button: 'right' });
    await expect(page.locator('#docker-row-menu [data-docker-menu-action="mute"]')).toContainText('Mute notifications');
    await expect(page.locator('#docker-row-menu [data-docker-menu-action="mute"]')).not.toContainText('Unmute');
  });

  test('Config → Containers: the switch, where notices go, and letting a muted one back in', async ({ page }) => {
    await mockDocker(page);
    const saved = await trackSettings(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.locator('[data-docker-row="jellyfin"]').click({ button: 'right' });
    await page.locator('#docker-row-menu [data-docker-menu-action="mute"]').click();
    await expect.poll(() => saved.at(-1)?.dockerNotifyMuted).toEqual(['jellyfin']);

    await page.goto('/#config/containers/alerts');
    const panel = page.locator('[data-docker-muted-panel]');
    await expect(panel).toBeVisible();
    // Where notices go -- or that nothing receives them yet.
    await expect(panel.locator('[data-docker-notify-receiver]')).not.toBeEmpty();
    const toggle = page.locator('#config-containers-body [data-behavior-field="dockerNotify"]');
    await expect(toggle).toBeChecked();

    await panel.locator('[data-docker-unmute="jellyfin"]').click();
    await expect.poll(() => saved.at(-1)?.dockerNotifyMuted).toEqual([]);
    await expect(page.locator('[data-docker-muted-panel] [data-docker-unmute]')).toHaveCount(0);
  });
});
