const { test, expect } = require('./fixtures');
const { useClassicType, WRITE_TOKEN } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Network checks on a bookmark: added, changed, muted and deleted from the
 * Tests tab of the side panel, through the keys and buttons a reader uses.
 */

const panel = (page) => page.locator('#config-bm-panel');
const net = (page) => panel(page).locator('[data-bm-tests]');
const cards = (page) => net(page).locator('[data-net-card]');

async function pick(page, name) {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
  await expect(panel(page).locator('.config-bm-panel-title')).toHaveText(name);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('4');
  await expect(panel(page).locator('[data-bm-pane="tests"]')).toBeVisible();
}

/** What the server holds for one bookmark. */
async function storedChecks(page, bookmark) {
  const res = await page.request.get(`/api/net/checks?pageId=${bookmark.pageId}&url=${encodeURIComponent(bookmark.url)}`);
  return (await res.json()).checks;
}

/** A check's accordion is closed until it is opened; its buttons live inside. */
async function openCard(card) {
  if (!(await card.evaluate((el) => el.open))) await card.locator('summary').click();
}

async function addTcpCheck(page, port) {
  await net(page).getByRole('button', { name: 'Add check' }).click();
  const form = net(page).locator('[data-net-form]');
  await expect(form).toBeVisible();
  await form.locator('[data-net-field="type"]').selectOption('tcp');
  await form.locator('[data-net-field="port"]').fill(String(port));
  await form.getByRole('button', { name: 'Save' }).click();
}

test.beforeEach(async ({ page }) => {
  // Every test starts on a fresh install: the checks of the one before are gone.
  const reset = await page.request.post('/api/reset', { data: { confirm: true }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
  expect(reset.ok()).toBe(true);
  await useClassicType(page);
});

test.describe('network check form', () => {
  test('a TCP check is added, survives a reload and is deleted', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[2];
    await pick(page, target.name);
    await expect(net(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(0);

    await addTcpCheck(page, 8443);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('summary')).toContainText('TCP 8443');
    expect((await storedChecks(page, target)).map((c) => c.type)).toEqual(['tcp']);

    // The server's copy, not the page's memory: reload and open it again.
    await openBookmarksWithHealth(page);
    await pick(page, target.name);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('summary')).toContainText('TCP 8443');

    await openCard(cards(page).first());
    await cards(page).first().getByRole('button', { name: 'Edit' }).click();
    await net(page).getByRole('button', { name: 'Delete check' }).click();
    // Deleting asks twice: the first click only arms the button.
    await expect(cards(page)).toHaveCount(1);
    await net(page).getByRole('button', { name: 'Delete it for good' }).click();
    await expect(cards(page)).toHaveCount(0);

    await openBookmarksWithHealth(page);
    await pick(page, target.name);
    await expect(cards(page)).toHaveCount(0);
    expect(await storedChecks(page, target)).toEqual([]);
  });

  test('a second check keeps the first: the whole list is sent', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[2];
    await pick(page, target.name);
    await addTcpCheck(page, 22);
    await expect(cards(page)).toHaveCount(1);
    await addTcpCheck(page, 443);
    await expect(cards(page)).toHaveCount(2);
    // Deleting the second leaves the first.
    await openCard(cards(page).nth(1));
    await cards(page).nth(1).getByRole('button', { name: 'Edit' }).click();
    await net(page).getByRole('button', { name: 'Delete check' }).click();
    await net(page).getByRole('button', { name: 'Delete it for good' }).click();
    await expect(cards(page)).toHaveCount(1);
    expect((await storedChecks(page, target)).map((c) => c.port)).toEqual([22]);
  });

  test('muting a card is stored and does not stop the check', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[2];
    await pick(page, target.name);
    await addTcpCheck(page, 8443);
    const card = cards(page).first();
    await openCard(card);
    await card.getByRole('button', { name: 'Mute', exact: true }).click();
    await openCard(card);
    await expect(card.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');
    const [stored] = await storedChecks(page, target);
    expect(stored.muted).toBe(true);
    expect(stored.enabled).toBe(true);
  });

  test('the form explains itself while it is filled in', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    await pick(page, bookmarks[2].name);
    await net(page).getByRole('button', { name: 'Add check' }).click();
    const form = net(page).locator('[data-net-form]');
    const explain = form.locator('[data-net-explain]');
    await form.locator('[data-net-field="type"]').selectOption('tcp');
    await form.locator('[data-net-field="port"]').fill('8443');
    await expect(explain).toContainText('port 8443');
    await form.locator('[data-net-field="planning"]').selectOption('off');
    await expect(explain).toContainText('Not scheduled');
    // Escape closes the form and leaves the panel where it was.
    await form.locator('[data-net-field="port"]').press('Escape');
    await expect(form).toHaveCount(0);
  });

  test('a port outside 1-65535 is refused before it is sent', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[2];
    await pick(page, target.name);
    await addTcpCheck(page, 70000);
    await expect(net(page).locator('[data-net-field-wrap="port"]')).toHaveClass(/is-error/);
    await expect(net(page).locator('[data-net-form]')).toBeVisible();
    expect(await storedChecks(page, target)).toEqual([]);
  });

  test('a tab opened before the check was added does not take it away', async ({ page, context }) => {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[2];

    // The second tab loads the page's bookmarks now, before any check exists.
    const stale = await context.newPage();
    await stale.goto('/');
    await stale.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });

    await pick(page, target.name);
    await addTcpCheck(page, 8443);
    await expect(cards(page)).toHaveCount(1);

    // The stale tab saves its page the way the dashboard does: the whole list,
    // from its own memory, with one name changed.
    const status = await stale.evaluate(async ({ pageId, url, token }) => {
      const list = window.dashboardInstance.allBookmarks
        .filter((b) => Number(b.pageId) === Number(pageId))
        .map((b) => ({ ...b, name: b.url === url ? 'Renamed in the stale tab' : b.name }));
      const res = await fetch(`/api/bookmarks?page=${pageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-NextDash-Token': token },
        body: JSON.stringify(list),
      });
      return res.status;
    }, { pageId: target.pageId, url: target.url, token: WRITE_TOKEN });
    expect(status).toBeLessThan(300);

    const rows = await (await page.request.get(`/api/bookmarks?page=${target.pageId}`)).json();
    expect(rows.find((b) => b.url === target.url).name).toBe('Renamed in the stale tab');
    const kept = await storedChecks(page, target);
    expect(kept.map((c) => c.port)).toEqual([8443]);
    await stale.close();
  });

  test('past the install-wide ceiling the second scheduled check is refused with a sentence', async ({ page }) => {
    await useClassicType(page, { netToolsMaxChecks: 1 });
    const { bookmarks } = await openBookmarksWithHealth(page);
    const target = bookmarks[2];
    await pick(page, target.name);
    await addTcpCheck(page, 22);
    await expect(cards(page)).toHaveCount(1);
    await addTcpCheck(page, 443);
    await expect(net(page).locator('[data-net-error]')).toContainText('too many scheduled network checks');
    await expect(cards(page)).toHaveCount(1);
    // The form is still there, so the reader can switch planning off and save again.
    await net(page).locator('[data-net-form]').locator('[data-net-field="planning"]').selectOption('off');
    await net(page).getByRole('button', { name: 'Save' }).click();
    await expect(cards(page)).toHaveCount(2);
    expect((await storedChecks(page, target)).map((c) => c.enabled === true)).toEqual([true, false]);
  });
});
