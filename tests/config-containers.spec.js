const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, markConfigSettingPromosSeen, dismissBlockingOverlays } = require('./e2e-helpers');

// The section is five tabs; a spec about one panel opens it by its deep link.
const WAIT_FOR = {
  connection: '[data-docker-status-panel]',
  view: '[data-behavior-field="dockerRefreshSeconds"]',
  updates: '[data-docker-token-panel]',
  alerts: '[data-docker-muted-panel]',
};

async function openSection(page, opts, tab = 'connection') {
  await markWhatsNewSeen(page);
  await markConfigSettingPromosSeen(page);
  const state = await mockDocker(page, opts);
  await page.goto(`/#config/containers/${tab}`);
  await page.waitForSelector(WAIT_FOR[tab], { timeout: 20_000 });
  await dismissBlockingOverlays(page);
  return state;
}

const getSettings = async (page) => (await page.request.get('/api/settings')).json();

test.describe('Config -> Containers', () => {
  test('is in the rail and draws the Behavior panels', async ({ page }) => {
    await openSection(page);
    await expect(page.locator('[data-config-section="containers"]')).toHaveAttribute('aria-selected', 'true');
    const titles = page.locator('#config-containers-body .config-panel-title');
    await expect(titles).toHaveText(['Connection', 'Safety']);
    await page.locator('[data-containers-tab="view"]').click();
    // The same rows Behavior uses, so they line up the same way.
    await expect(page.locator('#config-containers-body [data-behavior-field="dockerRefreshSeconds"]')).toBeVisible();
    await expect(page.locator('#config-containers-body .config-field').first()).toBeVisible();
  });

  test('connection status comes from the server', async ({ page }) => {
    await openSection(page, { control: true });
    await expect(page.locator('[data-docker-state="socket"]')).toHaveAttribute('data-tone', 'good');
    await expect(page.locator('[data-docker-state="control"]')).toHaveText(/on/i);
    await expect(page.locator('[data-docker-state="token"]')).toHaveAttribute('data-tone', 'warn');
    await expect(page.locator('[data-docker-state="self"]')).toHaveText('nextdash');
  });

  test('without a socket the setup steps show', async ({ page }) => {
    await openSection(page, { socket: false });
    await expect(page.locator('[data-docker-status-help]')).toContainText('NEXTDASH_DOCKER_SOCKET');
  });

  // The view switch works either way, but with no socket there is nothing for
  // the view to show: the switch says so, and points at the setup help.
  test('without a socket, the view switch explains why and links the setup help', async ({ page }) => {
    await openSection(page, { socket: false }, 'view');
    const note = page.locator('[data-docker-view-note]');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/not connected/i);
    await note.locator('[data-docker-setup-help]').click();
    await expect(page.locator('#help-panel-containers-setup')).toBeVisible();
    await expect(page).toHaveURL(/#config\/help\/containers\/containers-setup$/);
  });

  test('with the socket connected the switch carries no such note', async ({ page }) => {
    await openSection(page);
    await expect(page.locator('[data-docker-state="socket"]')).toHaveAttribute('data-tone', 'good');
    // The View tab asks again; wait for its answer before looking for a note.
    const answered = page.waitForResponse((r) => r.url().includes('/api/docker/status'));
    await page.locator('[data-containers-tab="view"]').click();
    await answered;
    await expect(page.locator('[data-behavior-field="dockerViewEnabled"]')).toBeVisible();
    await expect(page.locator('[data-docker-view-note]')).toHaveCount(0);
  });

  test('a schema setting saves', async ({ page }) => {
    await openSection(page, undefined, 'view');
    const select = page.locator('[data-behavior-field="dockerRefreshSeconds"]');
    await select.selectOption('10');
    await expect.poll(async () => (await getSettings(page)).dockerRefreshSeconds).toBe(10);
    await select.selectOption('5'); // shared data dir: leave it as found
    await expect.poll(async () => (await getSettings(page)).dockerRefreshSeconds).toBe(5);
  });

  test('hide and show a container', async ({ page }) => {
    await openSection(page, undefined, 'view');
    await page.locator('#config-docker-hide-input').fill('portainer');
    await page.locator('[data-docker-hide-add]').click();
    await expect(page.locator('.config-docker-chip', { hasText: 'portainer' })).toBeVisible();
    await expect.poll(async () => (await getSettings(page)).dockerHiddenContainers).toEqual(['portainer']);
    await page.locator('[data-docker-unhide="portainer"]').click();
    await expect(page.locator('.config-docker-chip')).toHaveCount(0);
    await expect.poll(async () => (await getSettings(page)).dockerHiddenContainers).toEqual([]);
  });

  test('the GitHub token is sent and never shown', async ({ page }) => {
    const state = await openSection(page, undefined, 'updates');
    await page.locator('#config-docker-github-token').fill('ghp_example');
    await page.locator('[data-docker-token-action="save"]').click();
    await expect(page.locator('[data-docker-token-state]')).toContainText(/saved/i);
    await expect(page.locator('#config-docker-github-token')).toHaveValue('');
    expect(state.calls).toContain('PUT /github-token');
    await page.locator('[data-docker-token-action="remove"]').click();
    await expect(page.locator('[data-docker-token-state]')).toContainText(/no token/i);
  });

  test('switching the view off takes the header button away', async ({ page }) => {
    await openSection(page, undefined, 'view');
    await expect(page.locator('#page-nav-docker-host a')).toHaveCount(1);
    const box = page.locator('[data-behavior-field="dockerViewEnabled"]');
    await box.uncheck();
    await expect(page.locator('#page-nav-docker-host a')).toHaveCount(0);
    await box.check(); // shared data dir: leave it as found
    await expect(page.locator('#page-nav-docker-host a')).toHaveCount(1);
    await expect.poll(async () => (await getSettings(page)).dockerViewEnabled).toBe(true);
  });

  test('the Widgets section no longer carries the Docker block', async ({ page }) => {
    await openSection(page);
    await page.goto('/#config/widgets');
    await page.waitForSelector('#config-widgets-body');
    await expect(page.locator('[data-setting="dockerUpdateInterval"]')).toHaveCount(0);
  });
});
