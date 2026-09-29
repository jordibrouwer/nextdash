const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openView(page) {
  const state = await mockDocker(page);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  return state;
}

// The Containers view's own keys -- l, m, d -- and Shift+Y into the view from
// the dashboard. None of them is taken anywhere else.
test.describe('containers keys', () => {
  test('d switches to Disk and back; typed in the search it is just a letter', async ({ page }) => {
    await openView(page);
    await page.locator('[data-docker-search]').focus();
    await page.keyboard.type('d');
    await expect(page.locator('[data-docker-disk]')).toHaveCount(0);
    await page.locator('[data-docker-search]').fill('');
    await page.locator('[data-docker-search]').blur();
    await page.keyboard.press('d');
    await expect(page.locator('[data-docker-disk]')).toBeVisible();
    await expect(page).toHaveURL(/#docker\/~disk$/);
    await page.keyboard.press('d');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  });

  test('l opens the logs window of the selected container', async ({ page }) => {
    await openView(page);
    await page.keyboard.press('ArrowDown');
    const selected = await page.locator('[data-docker-row].is-selected, [data-docker-row][aria-selected="true"]').first().getAttribute('data-docker-row');
    await page.keyboard.press('l');
    await expect(page.locator('[data-docker-logs-modal] .docker-logs-modal-title')).toHaveText(selected);
  });

  test('m mutes and unmutes the selected container', async ({ page }) => {
    await openView(page);
    const saved = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/settings') saved.push(JSON.parse(req.postData() || '{}'));
    });
    await page.keyboard.press('ArrowDown');
    const selected = await page.locator('[data-docker-row].is-selected, [data-docker-row][aria-selected="true"]').first().getAttribute('data-docker-row');
    await page.keyboard.press('m');
    await expect.poll(() => saved.at(-1)?.dockerNotifyMuted).toEqual([selected]);
    await page.keyboard.press('m');
    await expect.poll(() => saved.at(-1)?.dockerNotifyMuted).toEqual([]);
  });

  test('the legend names every key; read-only leaves out the actions', async ({ page }) => {
    await openView(page);
    const keys = () => page.locator('.docker-legend kbd').allInnerTexts();
    expect(await keys()).toEqual(['↑ / ↓', 'Enter', '/', 's', 'r', 'p', 'u', 'Del', 'l', 'm', 'd']);
  });

  test('read-only still has a legend, without the action keys', async ({ page }) => {
    await mockDocker(page, { control: false });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    expect(await page.locator('.docker-legend kbd').allInnerTexts()).toEqual(['↑ / ↓', 'Enter', '/', 'l', 'm', 'd']);
  });

  test('Shift+Y opens Containers from the dashboard', async ({ page }) => {
    await mockDocker(page);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('Shift+Y');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await expect(page).toHaveURL(/#docker$/);
  });
});
