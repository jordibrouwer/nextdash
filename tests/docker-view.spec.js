const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

test.describe('docker view', () => {
  test('opens from #docker and lists containers', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    const rows = page.locator('[data-docker-row]');
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: 'sonarr' })).toContainText('8989');
    await expect(page.locator('[data-docker-row="sonarr"] [data-docker-update-badge]')).toBeVisible();
  });

  test('nav button shows only with a socket', async ({ page }) => {
    await mockDocker(page, { socket: false });
    await page.goto('/');
    await expect(page.locator('#page-nav-docker-host a')).toHaveCount(0);
  });

  test('nav button opens the view', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/');
    await page.locator('#page-nav-docker-host a').click();
    await expect(page).toHaveURL(/#docker$/);
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  });

  test('without a socket the view shows the setup card', async ({ page }) => {
    await mockDocker(page, { socket: false });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-setup]')).toContainText('NEXTDASH_DOCKER_SOCKET');
  });

  test('#docker/<name> opens that container', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker/jellyfin');
    await expect(page.locator('[data-docker-drawer]')).toContainText('jellyfin');
    await expect(page.locator('[data-docker-row="jellyfin"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('Escape leaves the view', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-docker-row]')).toHaveCount(0);
  });

  test('search filters by name, image and port', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    const search = page.locator('[data-docker-search]');
    await search.fill('jelly');
    await expect(page.locator('[data-docker-row]')).toHaveCount(1);
    await search.fill('8989');
    await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible();
    await search.fill('linuxserver');
    await expect(page.locator('[data-docker-row]')).toHaveCount(2);
  });

  test('slash focuses search', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.keyboard.press('/');
    await expect(page.locator('[data-docker-search]')).toBeFocused();
  });

  test('filters count and narrow', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-filter="stopped"]')).toContainText('1');
    await page.locator('[data-docker-filter="updates"]').click();
    await expect(page.locator('[data-docker-row]')).toHaveCount(1);
  });

  test('check for updates posts and shows the time', async ({ page }) => {
    const state = await mockDocker(page);
    await page.goto('/#docker');
    await page.locator('[data-docker-check]').click();
    await expect.poll(() => state.calls.includes('POST /updates/check')).toBe(true);
    await expect(page.locator('[data-docker-checked-at]')).toContainText(/just now|0 min/);
  });

  test('read-only line without control', async ({ page }) => {
    await mockDocker(page, { control: false });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-readonly]')).toContainText('NEXTDASH_DOCKER_CONTROL=1');
  });
});
