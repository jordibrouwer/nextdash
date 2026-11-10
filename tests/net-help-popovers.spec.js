const { test, expect } = require('./fixtures');
const { useClassicType } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The info buttons of the Tests tab: each opens a short card under itself, Esc
 * closes it and gives focus back, a second card replaces the first, the keys
 * reach the button, and the card of the Type field follows the type.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-tests]');
const card = (page) => page.locator('.net-help-pop');
const btn = (page, key) => net(page).locator(`[data-net-help="${key}"]`);

async function open(page) {
  await page.route(/\/api\/net\/checks\?/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks: [] }) });
  });
  const { bookmarks } = await openBookmarksWithHealth(page);
  const target = bookmarks[2];
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: target.name }) }).first().click();
  await expect(panel(page).locator('.config-bm-panel-title')).toHaveText(target.name);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('4');
  await expect(panel(page).locator('[data-bm-pane="tests"]')).toBeVisible();
  await expect(btn(page, 'Tests')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await useClassicType(page);
});

test.describe('help cards in the Tests tab', () => {
  test('a heading button opens its card, Esc closes it and the focus returns', async ({ page }) => {
    await open(page);
    const b = btn(page, 'Tests');
    await b.click();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('What Tests does');
    await expect(card(page)).toContainText('Run once looks right now');
    await expect(card(page).locator('kbd')).toHaveText('4');
    await expect(b).toHaveAttribute('aria-expanded', 'true');
    // The card stays inside the panel's width.
    const box = await card(page).boundingBox();
    const pbox = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(pbox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(pbox.x + pbox.width + 1);
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(b).toBeFocused();
    // Neither the panel nor the page took the Escape.
    await expect(panel(page)).toBeVisible();
  });

  test('a second card replaces the first, and a click outside closes it', async ({ page }) => {
    await open(page);
    // A card lies over what is below its button, so the second button is the one above.
    await btn(page, 'Run').click();
    await expect(card(page)).toContainText('Never a free host or a port scan');
    await btn(page, 'Tests').click();
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText('What Tests does');
    await expect(btn(page, 'Run')).toHaveAttribute('aria-expanded', 'false');
    await panel(page).locator('.config-bm-panel-title').click();
    await expect(card(page)).toHaveCount(0);
  });

  test('the button in the Run once head opens its card without folding the accordion', async ({ page }) => {
    await open(page);
    const acc = net(page).locator('[data-bm-acc="run"]');
    const before = await acc.evaluate((d) => d.open);
    await btn(page, 'Run').click();
    await expect(card(page)).toContainText('Never a free host or a port scan');
    expect(await acc.evaluate((d) => d.open)).toBe(before);
  });

  test('the keys reach the button: Tab, then Enter or Space', async ({ page }) => {
    await open(page);
    await btn(page, 'Tests').focus();
    await page.keyboard.press('Enter');
    await expect(card(page)).toContainText('What Tests does');
    await page.keyboard.press('Enter');
    await expect(card(page)).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(card(page)).toContainText('Up 24 h');
    // Tabbing on leaves the card behind.
    await page.keyboard.press('Tab');
    await expect(card(page)).toHaveCount(0);
  });

  test('the Type card follows the type chosen in the form; the other fields have theirs', async ({ page }) => {
    await open(page);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    await expect(form).toBeVisible();
    const type = btn(page, 'type');
    await type.click();
    await expect(card(page)).toContainText('Opens a connection to a port');
    await form.locator('[data-net-field="type"]').selectOption('ping');
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText('net.ipv4.ping_group_range');
    await form.locator('[data-net-field="type"]').selectOption('dns');
    await expect(card(page)).toContainText('The DNSSEC chip is information only');
    await form.locator('[data-net-field="type"]').selectOption('json');
    await expect(card(page).locator('b').first()).toHaveText('JSON');
    await expect(card(page)).toContainText('trailing #');
    await expect(type).toHaveAttribute('aria-expanded', 'true');
    // Esc closes the card and leaves the form alone.
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(form).toBeVisible();
    await btn(page, 'Alerts').click();
    await expect(card(page)).toContainText('quiet hours and maintenance windows');
    await btn(page, 'Planning').click();
    await expect(card(page)).toContainText('shortest is 5 minutes');
    await btn(page, 'Timeout').click();
    await expect(card(page)).toContainText('before it counts as failed');
  });
});
