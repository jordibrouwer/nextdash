const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openView(page) {
  const state = await mockDocker(page);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  return state;
}

// The Containers view's own keys -- l, m, d -- and Shift+C into the view from
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
    expect(await keys()).toEqual(['↑ / ↓', 'Enter', '/', 'x', 's', 'r', 'p', 'u', '⌫', 'l', 'm', 'd']);
  });

  test('read-only still has a legend, without the action keys', async ({ page }) => {
    await mockDocker(page, { control: false });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    expect(await page.locator('.docker-legend kbd').allInnerTexts()).toEqual(['↑ / ↓', 'Enter', '/', 'x', 'l', 'm', 'd']);
  });

  async function loadDashboard(page) {
    await mockDocker(page);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.activeElement?.blur());
  }

  test('Shift+C opens Containers from the dashboard when no bookmark is selected', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Shift+C');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await expect(page).toHaveURL(/#docker$/);
  });

  test('Shift+C with a bookmark selected is Checking, not Containers', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+C');
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('docker');
    await expect(page).not.toHaveURL(/#docker/);
  });

  test('Shift+Y still opens Containers and names Shift + C', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
      window.__aliasToasts = [];
      window.dashboardInstance.showNotification = (m) => { window.__aliasToasts.push(String(m)); };
    });
    await page.keyboard.press('Shift+Y');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    const toasts = await page.evaluate(() => window.__aliasToasts);
    expect(toasts.some((m) => m.includes('Shift + Y') && m.includes('Shift + C'))).toBe(true);
  });

  test('Shift+C inside the Bookmarks view stays with the view', async ({ page }) => {
    await loadDashboard(page);
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
    await page.keyboard.press('Shift+C');
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
  });

  test('Shift+C typed in a text field opens nothing', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'probe-field';
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.press('Shift+C');
    await expect(page.locator('#probe-field')).toHaveValue('C');
    await expect(page).not.toHaveURL(/#docker/);
  });
});

// Config → Containers → The key legend: the same three choices as Bookmarks
// and Inbox. Above is where the Containers legend always stood.
test.describe('containers key legend placement', () => {
  const order = (page) => page.evaluate(() => {
    const body = document.querySelector('.docker-table')?.parentElement;
    return [...(body?.children || [])].map((el) => (el.classList.contains('docker-legend') ? 'legend'
      : el.classList.contains('docker-table') ? 'table' : null)).filter(Boolean);
  });
  for (const [choice, want] of [[undefined, ['legend', 'table']], ['above', ['legend', 'table']], ['below', ['table', 'legend']], ['off', ['table']]]) {
    test(`legend ${choice || 'by default'}`, async ({ page }) => {
      await mockDocker(page);
      await page.goto('/#docker');
      await expect(page.locator('[data-docker-row]')).toHaveCount(4);
      if (choice) {
        await page.evaluate((c) => { window.dashboardInstance.settings.dockerViewKeyLegend = c; window.dashboardInstance.docker.instance.render(); }, choice);
      }
      await expect.poll(() => order(page)).toEqual(want);
    });
  }
});
