const { test, expect } = require('./fixtures');
const { openHealthWith, row } = require('./helpers/health-report');

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
    await expect(selected.locator('[data-health-action="recheck"]')).toBeVisible();
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
