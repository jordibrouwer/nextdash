const { test, expect } = require('./fixtures');
const { openInboxWith, stubInbox, item } = require('./helpers/inbox-report');

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

  test('a row is one line; Open, Promote and Keep are the side panel\'s buttons', async ({ page }) => {
    await openInboxWith(page);
    await expect(page.locator('.inbox-item-line2')).toHaveCount(0);
    await expect(page.locator('.inbox-item [data-inbox-action]')).toHaveCount(0);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    const actions = await page.locator('[data-lvs-drawer="inbox"] .config-bm-panel-actions [data-slp-action]')
      .evaluateAll((els) => els.map((e) => e.dataset.slpAction));
    expect(actions.filter((a) => a !== 'keep')).toEqual(['open', 'promote']);
  });

  test('hovering selects without opening', async ({ page }) => {
    await openInboxWith(page);
    await page.mouse.move(0, 0);
    await item(page, 'Read one').hover();
    await page.mouse.move(400, 10, { steps: 2 });
    await item(page, 'Read one').hover();
    await expect(item(page, 'Read one')).toHaveClass(/keyboard-selected/);
    await expect(page.locator('[data-lvs-drawer="inbox"] [data-lvs-drawer-panel]')).toHaveCount(0);
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
  const section = (page, name) => drawer(page).locator(`[data-slp-acc="${name}"]`);
  const title = (page) => drawer(page).locator('.config-bm-panel-title');
  // Mark read, Snooze and the rest sit under the head's ⋯.
  async function fromMore(page, action) {
    await drawer(page).locator('[data-slp-more]').click();
    await drawer(page).locator(`[data-slp-more-menu] [data-slp-action="${action}"]`).click();
  }

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
    const name = await page.locator('.inbox-item[data-inbox-open] .inbox-item-title').textContent();
    await expect(drawer(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText(name);
    await expect(drawer(page).locator('a[href^="https://example.com/"]')).toHaveCount(1);
  });

  test('a click shows the summary on top and the sections under it', async ({ page }) => {
    await openInboxWith(page);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    await expect(title(page)).toHaveText('Unread one');
    await expect(drawer(page).locator('.config-bm-details-viz')).toContainText('A page about things');
    for (const name of ['note', 'tags', 'details', 'remove']) {
      await expect(section(page, name)).toHaveCount(1);
    }
    await expect(section(page, 'note').locator('[data-inbox-note]')).toHaveValue('Read this first');
    await expect(section(page, 'tags').locator('[data-inbox-tag="work"]')).toHaveCount(1);
    await section(page, 'details').locator('summary').click();
    await expect(section(page, 'details')).toContainText('extension');
  });

  test('the note is edited in place, and kept on leaving the field', async ({ page }) => {
    await openInboxWith(page);
    const writes = await answerWrites(page);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    const note = section(page, 'note').locator('[data-inbox-note]');
    await note.fill('Changed in the panel');
    await note.press('Tab');
    await expect.poll(() => writes.some((w) => w.body?.id === 'ib-unread' && w.body?.note === 'Changed in the panel')).toBe(true);
  });

  test('Mark read in the panel sends the read, and the panel then offers unread', async ({ page }) => {
    await openInboxWith(page);
    const writes = await answerWrites(page);
    await item(page, 'Unread one').locator('.inbox-item-title').click();
    await fromMore(page, 'read');
    await expect.poll(() => writes.some((w) => w.body?.id === 'ib-unread' && w.body?.readAt)).toBe(true);
    await expect(drawer(page).locator('[data-slp-more-menu] [data-slp-action="unread"]')).toHaveCount(1);
    await expect(item(page, 'Unread one')).not.toHaveAttribute('data-lvs-status', /.+/);
  });

  test('Snooze in the panel opens the snooze menu', async ({ page }) => {
    await openInboxWith(page);
    await item(page, 'Read one').locator('.inbox-item-title').click();
    await fromMore(page, 'snooze');
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
    const first = await title(page).textContent();
    await page.keyboard.press('j');
    const next = await page.locator('.inbox-item[data-inbox-open] .inbox-item-title').textContent();
    expect(next).not.toBe(first);
    await expect(title(page)).toHaveText(next);
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

test.describe('inbox redesign: keys and phone', () => {
  test('the legend teaches Enter for details and o / Space to open', async ({ page }) => {
    await openInboxWith(page);
    const keys = (await page.locator('.inbox-legend kbd, .inbox-view-legend kbd').allTextContents()).map((k) => k.trim());
    expect(keys).toContain('Enter');
    expect(keys).toContain('o / Space');
  });

  test('on a phone the panel is full screen and Esc gives the scroll back', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // The header's inbox link is folded away at this width; the address opens it.
    await stubInbox(page);
    await page.goto('/#inbox');
    await page.waitForSelector('.inbox-layout .inbox-item', { timeout: 15_000 });
    const before = await page.evaluate(() => window.ScrollLock?.holders?.size ?? 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    const panel = page.locator('[data-lvs-drawer="inbox"] [data-lvs-drawer-panel]');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBeGreaterThanOrEqual(await page.evaluate(() => window.innerWidth) - 16);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => window.ScrollLock.holders.size)).toBe(before);
  });
});
