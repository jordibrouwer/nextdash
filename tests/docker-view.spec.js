const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

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

  test('the drawer takes the Bookmarks side panel\'s layout: a head, four tabs, Overview as an accordion', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker/sonarr');
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer.locator('.config-bm-panel-head .config-bm-panel-title')).toHaveText('sonarr');
    await expect(drawer.locator('.config-bm-panel-head [data-docker-state]')).not.toBeEmpty();
    const tabs = await drawer.locator('[data-slp-tab]').evaluateAll((els) => els.map((e) => e.dataset.slpTab));
    expect(tabs).toEqual(['overview', 'resources', 'logs', 'changes']);
    for (const key of ['overview', 'network', 'volumes', 'env']) {
      await expect(drawer.locator(`[data-slp-pane="overview"] [data-slp-acc="${key}"]`)).toHaveCount(1);
    }
    await drawer.locator('[data-slp-tab="logs"]').click();
    await expect(drawer.locator('[data-slp-pane="overview"]')).toBeHidden();
    await expect(drawer.locator('[data-docker-logs]')).toBeVisible();
  });

  test('Enter opens the drawer with details and hidden env', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker');
    await page.locator('[data-docker-row="sonarr"]').click();
    await page.keyboard.press('Enter');
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer).toContainText('unless-stopped');
    await expect(drawer).toContainText('172.17.0.5');
    await expect(drawer).toContainText('/config');
    await expect(drawer).not.toContainText('secret-value');
    await drawer.locator('[data-docker-section="env"] summary').click();
    await drawer.locator('[data-docker-env-reveal="API_KEY"]').click();
    await expect(drawer.locator('[data-docker-env-value]')).toHaveText('secret-value');
    await expect(page).toHaveURL(/#docker\/sonarr$/);
  });

  // Health is its own accordion part, there only for a container with a
  // healthcheck, and it asks for the checks when it is opened.
  test('health shows the recent checks, and only where there is a healthcheck', async ({ page }) => {
    const state = await mockDocker(page);
    await page.goto('/#docker/sonarr');
    const drawer = page.locator('[data-docker-drawer]');
    const health = drawer.locator('[data-docker-section="health"]');
    await expect(health).toBeVisible();
    expect(state.calls.some((c) => c.endsWith('/health'))).toBe(false);
    await health.locator('summary').click();
    await expect(health.locator('[data-docker-health-command]')).toHaveText('curl -f http://localhost:8989/ping');
    const checks = health.locator('[data-docker-health-check]');
    await expect(checks).toHaveCount(2);
    await expect(checks.first()).toHaveAttribute('data-docker-health-check', 'fail');
    await expect(checks.first()).toContainText('exit 1');
    await expect(checks.first()).toContainText('Failed to connect');
    await expect(checks.nth(1)).toHaveAttribute('data-docker-health-check', 'pass');

    // jellyfin has no healthcheck: no Health part at all.
    await page.goto('/#docker/jellyfin');
    await expect(drawer.locator('.config-bm-panel-title')).toHaveText('jellyfin');
    await expect(drawer.locator('[data-docker-section="health"]')).toBeHidden();
  });

  test('logs load on open and refresh on demand', async ({ page }) => {
    const state = await mockDocker(page);
    await page.goto('/#docker/sonarr');
    const drawer = page.locator('[data-docker-drawer]');
    await drawer.locator('[data-slp-tab="logs"]').click();
    await expect(drawer.locator('[data-docker-logs]')).toContainText('line two');
    const before = state.calls.filter((c) => c.endsWith('/logs')).length;
    await drawer.locator('[data-docker-logs-refresh]').click();
    await expect.poll(() => state.calls.filter((c) => c.endsWith('/logs')).length).toBe(before + 1);
  });

  test('changes show releases as text with links, no HTML', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker/sonarr');
    const changes = page.locator('[data-docker-section="changes"]');
    await page.locator('[data-docker-drawer] [data-slp-tab="changes"]').click();
    await expect(changes).toContainText('4.0.10');
    await expect(changes).toContainText('## Fixes');
    await expect(changes.locator('a[href="https://example.com/x"]')).toHaveAttribute('rel', /noopener/);
    await expect(changes.locator('a[data-docker-link="source"]')).toHaveAttribute('href', 'https://github.com/linuxserver/docker-sonarr');
  });

  test('resources poll only while their tab is on show', async ({ page }) => {
    const state = await mockDocker(page);
    await page.goto('/#docker/sonarr');
    // Resources is a tab: it polls while on show, and stops when another is.
    await page.locator('[data-docker-drawer] [data-slp-tab="resources"]').click();
    await expect(page.locator('[data-docker-cpu]')).toContainText('3.2');
    await page.locator('[data-docker-drawer] [data-slp-tab="overview"]').click();
    const n = state.calls.filter((c) => c.endsWith('/stats')).length;
    await page.waitForTimeout(2500);
    expect(state.calls.filter((c) => c.endsWith('/stats')).length).toBe(n);
  });

  test('Escape closes the drawer before the view', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker/sonarr');
    await expect(page.locator('[data-docker-drawer]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-docker-drawer]')).toBeHidden();
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await expect(page).toHaveURL(/#docker$/);
  });

  test('drawer links use the accent, like the port links', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker/sonarr');
    const changes = page.locator('[data-docker-section="changes"]');
    await page.locator('[data-docker-drawer] [data-slp-tab="changes"]').click();
    const link = changes.locator('a[data-docker-link="source"]');
    await expect(link).toBeVisible();
    const [linkColor, portColor, underline] = await page.evaluate(() => {
      const a = document.querySelector('[data-docker-section="changes"] a[data-docker-link="source"]');
      const port = document.querySelector('.docker-port');
      return [getComputedStyle(a).color, getComputedStyle(port).color, getComputedStyle(a).textDecorationLine];
    });
    expect(linkColor).toBe(portColor);
    expect(underline).toBe('none');
  });

  test('the drawer draws over the sticky header', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#docker/sonarr');
    const drawer = page.locator('[data-docker-drawer]');
    await expect(drawer).toContainText('sonarr');
    const header = await page.locator('.lvs-header').boundingBox();
    const box = await drawer.boundingBox();
    // A point both cover: whatever is on top there must belong to the drawer.
    const onTop = await page.evaluate(([x, y]) => Boolean(
      document.elementFromPoint(x, y)?.closest('[data-docker-drawer]')),
      [box.x + 20, header.y + header.height / 2]);
    expect(onTop).toBe(true);
  });

  test('phone: two-line rows and a fullscreen drawer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockDocker(page);
    await page.goto('/#docker');
    const row = page.locator('[data-docker-row="sonarr"]');
    // Wait for real content before dismissing, like dashboard-bookmark-drag —
    // otherwise the quick-start card can still be mounting when we look for it
    // and then arrives later, on top of the list, at this width.
    await row.waitFor({ state: 'visible' });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const startLocks = await page.evaluate(() => window.ScrollLock?.holders.size ?? 0);
    await expect(row.locator('.docker-row-line2')).toBeVisible();
    await row.click();
    await page.keyboard.press('Enter');
    // Fullscreen from the left edge. ScrollLock keeps a scrollbar gutter so
    // the page does not jump; a phone's overlay scrollbar has none.
    const box = await page.locator('[data-docker-drawer]').boundingBox();
    const viewport = await page.evaluate(() => window.innerWidth);
    expect(box.x).toBe(0);
    expect(box.width).toBeGreaterThanOrEqual(viewport - 16);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    expect(await page.evaluate(() => window.ScrollLock?.holders.size ?? 0)).toBe(startLocks);
  });
});
