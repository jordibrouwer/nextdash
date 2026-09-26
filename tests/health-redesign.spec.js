const { test, expect } = require('./fixtures');
const { openHealthWith, redesignReport, row } = require('./helpers/health-report');

test.describe('health redesign: rows', () => {
  test('line one carries title, domain, reason and score', async ({ page }) => {
    await openHealthWith(page);
    const broken = row(page, 'Broken one');
    const line1 = broken.locator('.health-view-line1');
    await expect(line1.locator('.health-view-item-title')).toHaveText('Broken one');
    await expect(line1.locator('.health-view-item-domain')).toContainText('example.com');
    await expect(line1.locator('.health-view-item-reason')).toContainText('HTTP 500');
    await expect(line1.locator('.health-view-item-score')).toContainText('25');
  });

  test('each row says its status', async ({ page }) => {
    await openHealthWith(page);
    await expect(row(page, 'Broken one')).toHaveAttribute('data-lvs-status', 'bad');
    await expect(row(page, 'Drifted one')).toHaveAttribute('data-lvs-status', 'warn');
    await expect(row(page, 'Monitored one')).toHaveAttribute('data-lvs-status', 'info');
    await expect(row(page, 'Muted one')).toHaveAttribute('data-lvs-status', 'muted');
    await expect(row(page, 'Healthy one')).toHaveAttribute('data-lvs-status', 'good');
  });

  test('line two opens only for the focused row', async ({ page }) => {
    await openHealthWith(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await expect(page.locator('.health-view-line2:visible')).toHaveCount(0);
    await page.keyboard.press('j');
    const selected = page.locator('.health-view-item[aria-selected="true"]');
    await expect(selected.locator('.health-view-line2')).toBeVisible();
    await expect(selected.locator('[data-health-action="open"]')).toBeVisible();
    await expect(page.locator('.health-view-line2:visible')).toHaveCount(1);
  });

  test('hovering selects a row without opening it', async ({ page }) => {
    await openHealthWith(page);
    await page.mouse.move(0, 0);
    await row(page, 'Healthy one').hover();
    await page.mouse.move(400, 10, { steps: 2 });
    await row(page, 'Healthy one').hover();
    await expect(row(page, 'Healthy one').locator('.health-view-line2')).toBeHidden();
    await row(page, 'Healthy one').locator('.health-view-item-title').click();
    await expect(row(page, 'Healthy one').locator('.health-view-line2')).toBeVisible();
  });

  test('p still re-checks the focused row', async ({ page }) => {
    await openHealthWith(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.keyboard.press('p');
    await expect.poll(() => posts.some((u) => /check-url|update-status|ping|retest/.test(u))).toBe(true);
  });

  test('the checkbox rests hidden and shows on hover or while selecting', async ({ page }) => {
    await openHealthWith(page);
    await page.mouse.move(0, 0);
    const box = (name) => row(page, name).locator('.health-view-select');
    await expect(box('Healthy one')).toBeHidden();
    await row(page, 'Healthy one').hover();
    await expect(box('Healthy one')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect(box('Healthy one')).toBeVisible();
  });

  test('group by status', async ({ page }) => {
    await openHealthWith(page);
    await page.locator('select[data-health-group]').selectOption('status');
    const heads = page.locator('.health-view-group-head, [data-health-group-status]');
    await expect(heads.first()).toBeVisible();
    const order = await page.locator('[data-health-group-status]').evaluateAll((els) => els.map((e) => e.getAttribute('data-health-group-status')));
    expect(order).toEqual(['bad', 'warn', 'info', 'muted', 'good']);
  });

  test('no density toggle in the toolbar', async ({ page }) => {
    await openHealthWith(page);
    await expect(page.locator('.health-layout .lvs-density')).toHaveCount(0);
  });
});

// The broken row, monitored with a little history, so every panel section has
// something to show.
function monitoredBrokenReport() {
  const report = redesignReport();
  const now = Date.now();
  Object.assign(report.issues[0], {
    monitor: true,
    checkStatus: true,
    monitorStats: {
      intervalMinutes: 5,
      uptime24h: { ratio: 0.5, samples: 2 },
      heartbeat: [
        { state: 'up', from: now - 600000, to: now - 300000, up: 1, down: 0, avgMs: 120 },
        { state: 'down', from: now - 300000, to: now, up: 0, down: 1, avgMs: 0 },
      ],
      incidents: [],
      lastSample: now,
      totalChecks: 2,
      downSince: now - 300000,
    },
  });
  return report;
}

test.describe('health redesign: side panel', () => {
  const drawer = (page) => page.locator('[data-lvs-drawer="health"] [data-lvs-drawer-panel]');
  const section = (page, name) => drawer(page).locator(`[data-lvs-section="${name}"]`);

  async function selectFirst(page) {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    return page.locator('.health-view-item[aria-selected="true"] .health-view-item-title').textContent();
  }

  test('Enter opens the panel with the title and the URL', async ({ page }) => {
    await openHealthWith(page);
    const title = await selectFirst(page);
    await expect(drawer(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText(title);
    await expect(drawer(page).locator('a[href^="https://example.com/"]')).toHaveCount(1);
  });

  test('a click on a row opens every section for a monitored broken bookmark', async ({ page }) => {
    await openHealthWith(page, monitoredBrokenReport());
    await row(page, 'Broken one').locator('.health-view-item-domain').click();
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText('Broken one');
    for (const name of ['why', 'score', 'check', 'expect', 'monitor']) {
      await expect(section(page, name)).toHaveCount(1);
    }
    await expect(section(page, 'why')).toContainText('HTTP 500');
  });

  test('s opens the panel on the score', async ({ page }) => {
    await openHealthWith(page);
    await selectFirst(page);
    await page.keyboard.press('s');
    await expect(section(page, 'score')).toHaveAttribute('open', '');
    await expect(section(page, 'score').locator('.health-view-score-item').first()).toBeVisible();
  });

  test('a click on the score opens the panel on the score', async ({ page }) => {
    await openHealthWith(page);
    await row(page, 'Broken one').locator('.health-view-item-score').click();
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText('Broken one');
    await expect(section(page, 'score')).toHaveAttribute('open', '');
  });

  test('Esc closes the panel, and the next Esc leaves the view', async ({ page }) => {
    await openHealthWith(page);
    await selectFirst(page);
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dashboard-layout')).not.toHaveClass(/health-layout/);
  });

  test('o opens the bookmark', async ({ page }) => {
    await openHealthWith(page);
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => { window.__opened.push(url); return null; };
    });
    await selectFirst(page);
    const url = await page.locator('.health-view-item[aria-selected="true"] .health-view-item-domain').textContent();
    await page.keyboard.press('o');
    await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
    expect(await page.evaluate(() => window.__opened[0])).toContain(url.trim());
    await expect(drawer(page)).toHaveCount(0);
  });

  test('j with the panel open moves the panel to the next row', async ({ page }) => {
    await openHealthWith(page);
    const first = await selectFirst(page);
    await page.keyboard.press('Enter');
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText(first);
    await page.keyboard.press('j');
    const next = await page.locator('.health-view-item[aria-selected="true"] .health-view-item-title').textContent();
    expect(next).not.toBe(first);
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText(next);
  });

  test('Re-check and the check mode live in the panel, not the row', async ({ page }) => {
    await openHealthWith(page);
    await expect(page.locator('.health-view-item [data-health-action="recheck"]')).toHaveCount(0);
    await expect(page.locator('.health-view-item .health-check-mode')).toHaveCount(0);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
    await row(page, 'Broken one').locator('.health-view-item-domain').click();
    await expect(section(page, 'check').locator('.health-check-option')).toHaveCount(3);
    await drawer(page).locator('[data-health-drawer-action="recheck"]').click();
    await expect.poll(() => posts.some((u) => /check-url|update-status|ping|retest/.test(u))).toBe(true);
  });

  test('expectations saved from the panel go to the same endpoint', async ({ page }) => {
    await openHealthWith(page, monitoredBrokenReport());
    let posted = null;
    await page.route('**/api/health/expectations', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', expectText: posted.expectText }) });
    });
    await row(page, 'Broken one').locator('.health-view-item-domain').click();
    const expectSection = section(page, 'expect');
    if (await expectSection.getAttribute('open') === null) await expectSection.locator('summary').click();
    await expectSection.locator('[data-expect-text]').fill('Welcome');
    await expectSection.locator('[data-expect-save]').click();
    await expect.poll(() => posted?.expectText).toBe('Welcome');
    expect(posted).toMatchObject({ url: 'https://example.com/broken', expectStatus: '' });
  });
});

test.describe('health redesign: keys and phone', () => {
  const drawer = (page) => page.locator('[data-lvs-drawer="health"] [data-lvs-drawer-panel]');

  test('the legend teaches Enter for details and o / Space to open', async ({ page }) => {
    await openHealthWith(page);
    const legend = page.locator('.health-view-legend').first();
    const keyFor = async (label) => legend.locator('.health-view-legend-item, li, span')
      .filter({ hasText: label }).first().locator('kbd').allTextContents();
    await expect(legend).toContainText('details');
    expect((await keyFor('details')).join(' ')).toContain('Enter');
    expect((await keyFor('open')).join(' ')).toMatch(/o/);
    expect((await keyFor('refresh report')).join(' ')).not.toContain('?');
  });

  test('on a phone Enter opens the panel full screen, and Esc gives the scroll back', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // The header's Health link is folded away at this width; the address opens it.
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(redesignReport()),
    }));
    await page.goto('/#health');
    await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
    await page.locator('[data-health-filter="all"]').first().click();
    await page.waitForSelector('.health-view-item', { timeout: 15_000 });
    const before = await page.evaluate(() => window.ScrollLock?.holders?.size ?? 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    const box = await drawer(page).boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    expect(box.x).toBe(0);
    expect(box.width).toBeGreaterThanOrEqual(width - 16);
    expect(await page.evaluate(() => window.ScrollLock.holders.size)).toBe(before + 1);
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.ScrollLock.holders.size)).toBe(before);
  });
});
