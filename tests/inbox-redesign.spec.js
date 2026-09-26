const { test, expect } = require('./fixtures');
const { openInboxWith, item } = require('./helpers/inbox-report');

test.describe('inbox redesign: rows', () => {
  test('line one carries title, domain and when; the rest is not in the row', async ({ page }) => {
    await openInboxWith(page);
    const row = item(page, 'Unread one');
    const line1 = row.locator('.inbox-item-line1');
    await expect(line1.locator('.inbox-item-title')).toHaveText('Unread one');
    await expect(line1.locator('.inbox-item-domain-btn')).toContainText('example.com');
    await expect(line1.locator('.inbox-item-when')).not.toBeEmpty();
    await expect(row.locator('.inbox-item-desc, .inbox-item-note, [data-inbox-tag]')).toHaveCount(0);
  });

  test('each row says its status', async ({ page }) => {
    await openInboxWith(page);
    await expect(item(page, 'Unread one')).toHaveAttribute('data-lvs-status', 'info');
    await expect(item(page, 'Read one')).not.toHaveAttribute('data-lvs-status', /.+/);
  });

  test('a snoozed row is muted and says when it wakes', async ({ page }) => {
    await openInboxWith(page);
    await page.locator('[data-inbox-filter="snoozed"]').first().click();
    const row = item(page, 'Snoozed one');
    await expect(row).toHaveAttribute('data-lvs-status', 'muted');
    await expect(row.locator('.inbox-item-when')).toContainText(/sleeping/i);
  });

  test('line two opens for the keyboard row, with Open, Promote and Keep only', async ({ page }) => {
    await openInboxWith(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await expect(page.locator('.inbox-item-line2:visible')).toHaveCount(0);
    await page.keyboard.press('j');
    const line2 = page.locator('.inbox-item[data-inbox-open] .inbox-item-line2');
    await expect(line2).toBeVisible();
    const actions = await line2.locator('[data-inbox-action]').evaluateAll((els) => els.map((e) => e.dataset.inboxAction));
    expect(actions.filter((a) => a !== 'keep')).toEqual(['open', 'promote']);
    await expect(page.locator('.inbox-item-line2:visible')).toHaveCount(1);
  });

  test('hovering selects without opening', async ({ page }) => {
    await openInboxWith(page);
    await page.mouse.move(0, 0);
    await item(page, 'Read one').hover();
    await page.mouse.move(400, 10, { steps: 2 });
    await item(page, 'Read one').hover();
    await expect(item(page, 'Read one')).toHaveClass(/keyboard-selected/);
    await expect(item(page, 'Read one').locator('.inbox-item-line2')).toBeHidden();
  });

  test('the checkbox rests hidden and shows on hover', async ({ page }) => {
    await openInboxWith(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    const box = item(page, 'Read one').locator('.inbox-item-check');
    await expect(box).toBeHidden();
    await item(page, 'Read one').hover();
    await expect(box).toBeVisible();
  });

  test('no density toggle in the toolbar', async ({ page }) => {
    await openInboxWith(page);
    await expect(page.locator('.inbox-layout .lvs-density')).toBeHidden();
  });
});

test.describe('inbox redesign: side panel', () => {
  const drawer = (page) => page.locator('[data-lvs-drawer="inbox"] [data-lvs-drawer-panel]');
  const section = (page, name) => drawer(page).locator(`[data-lvs-section="${name}"]`);

  // The stubbed items do not exist on the server, so writes are answered here.
  async function answerWrites(page) {
    const writes = [];
    await page.route('**/api/inbox**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') return route.fallback();
      writes.push({ method, body: route.request().postDataJSON?.() ?? null, url: route.request().url() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
    });
    return writes;
  }

  test('Enter opens the panel with the title and the URL', async ({ page }) => {
    await openInboxWith(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    const title = await page.locator('.inbox-item[data-inbox-open] .inbox-item-title').textContent();
    await expect(drawer(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText(title);
    await expect(drawer(page).locator('a[href^="https://example.com/"]')).toHaveCount(1);
  });

  test('a click opens every section for an item with preview, note and tags', async ({ page }) => {
    await openInboxWith(page);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText('Unread one');
    for (const name of ['preview', 'note', 'tags', 'details']) {
      await expect(section(page, name)).toHaveCount(1);
    }
    await expect(section(page, 'preview')).toContainText('A page about things');
    await expect(section(page, 'note')).toContainText('Read this first');
    await expect(section(page, 'tags').locator('[data-inbox-tag="work"]')).toHaveCount(1);
    await expect(section(page, 'details')).toContainText('extension');
  });

  test('Mark read in the panel sends the read, and the panel then offers unread', async ({ page }) => {
    await openInboxWith(page);
    const writes = await answerWrites(page);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    await drawer(page).locator('[data-inbox-drawer-action="read"]').click();
    await expect.poll(() => writes.some((w) => w.body?.id === 'ib-unread' && w.body?.readAt)).toBe(true);
    await expect(drawer(page).locator('[data-inbox-drawer-action="unread"]')).toBeVisible();
    await expect(item(page, 'Unread one')).not.toHaveAttribute('data-lvs-status', /.+/);
  });

  test('Snooze in the panel opens the snooze menu', async ({ page }) => {
    await openInboxWith(page);
    await item(page, 'Read one').locator('.inbox-item-title').click();
    await drawer(page).locator('[data-inbox-drawer-action="snooze"]').click();
    await expect(page.locator('.inbox-snooze-menu')).toBeVisible();
  });

  test('o opens the link; Esc closes the panel, the next Esc leaves', async ({ page }) => {
    await openInboxWith(page);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.keyboard.press('o');
    await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
    await expect(drawer(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.locator('#dashboard-layout')).toHaveClass(/inbox-layout/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dashboard-layout')).not.toHaveClass(/inbox-layout/);
  });

  test('j with the panel open moves the panel to the next row', async ({ page }) => {
    await openInboxWith(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    const first = await drawer(page).locator('.lvs-drawer-title').textContent();
    await page.keyboard.press('j');
    const next = await page.locator('.inbox-item[data-inbox-open] .inbox-item-title').textContent();
    expect(next).not.toBe(first);
    await expect(drawer(page).locator('.lvs-drawer-title')).toHaveText(next);
  });

  test('ticking two rows closes the panel', async ({ page }) => {
    await openInboxWith(page);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    await expect(drawer(page)).toBeVisible();
    await item(page, 'Unread one').hover();
    await item(page, 'Unread one').locator('.inbox-item-check-input').check();
    await expect(drawer(page)).toBeVisible();
    await item(page, 'Read one').hover();
    await item(page, 'Read one').locator('.inbox-item-check-input').check();
    await expect(drawer(page)).toHaveCount(0);
  });
});
