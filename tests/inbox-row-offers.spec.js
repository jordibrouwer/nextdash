// @ts-check
const { test, expect } = require('./fixtures');
const { openInboxWith, item } = require('./helpers/inbox-report');

/**
 * The inbox shows a tag on offer in the row, as the Bookmarks view does: a
 * Tags column with the row's own tags and one dashed chip, which a click (or
 * `a`) adds and × turns down, and a line over the list that counts them with
 * Add all. The writes go through the inbox batch, so they are captured here.
 */

async function openWithOffers(page) {
  const writes = [];
  await page.route('**/api/inbox/batch', async (route) => {
    writes.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ missing: [] }) });
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openInboxWith(page);
  // A predictable engine: each item gets one offer named after it.
  await page.evaluate(() => {
    window.TagSuggestLive.forInboxItem = (_dash, entry) => [{ tag: `for-${entry.id}`, pattern: `p-${entry.id}`, reason: { kind: 'catalogue' } }];
    window.dashboardInstance.inbox.render();
  });
  return writes;
}

const offer = (page, title) => item(page, title).locator('.tag-offer');

test('a row shows its own tags and its offer, and the line counts the offers', async ({ page }) => {
  await openWithOffers(page);
  await expect(item(page, 'Unread one').locator('.inbox-row-tag', { hasText: 'work' })).toBeVisible();
  await expect(offer(page, 'Read one')).toHaveAttribute('data-inbox-offer', 'for-ib-read');
  await expect(offer(page, 'Read one')).toHaveAttribute('title', /catalogue/);
  await expect(page.locator('.inbox-offers')).toContainText('2 tag suggestions in this list');
});

test('a click adds the tag without opening the row, and Undo takes it off', async ({ page }) => {
  const writes = await openWithOffers(page);
  await offer(page, 'Read one').locator('[data-inbox-offer-add]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ op: 'tag', ids: ['ib-read'], addTags: ['for-ib-read'] });
  await expect(page.locator('[data-lvs-drawer="inbox"]')).toBeHidden();
  await expect(offer(page, 'Read one')).toHaveCount(0);
  await expect(item(page, 'Read one').locator('.inbox-row-tag', { hasText: 'for-ib-read' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ op: 'tag', ids: ['ib-read'], removeTags: ['for-ib-read'] });
  await expect(offer(page, 'Read one')).toBeVisible();
});

test('a adds the offer on the row under the cursor', async ({ page }) => {
  const writes = await openWithOffers(page);
  await item(page, 'Read one').locator('.inbox-item-title').click();
  await page.keyboard.press('a');
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ op: 'tag', ids: ['ib-read'], addTags: ['for-ib-read'] });
});

// The snoozed row sleeps outside All, so two rows carry an offer.
test('Add all takes every offer in the list', async ({ page }) => {
  const writes = await openWithOffers(page);
  await page.locator('.inbox-offers [data-inbox-offers-all]').click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map((w) => w.addTags[0]).sort()).toEqual(['for-ib-read', 'for-ib-unread']);
  await expect(page.locator('.inbox-offers')).toBeHidden();
});

// More offers than the one chip: `+N` opens all of them, each to add or
// turn down, in the popover the Bookmarks view and the tag view use.
test('+N opens every offer on the row, and one picked there is added', async ({ page }) => {
  const writes = await openWithOffers(page);
  await page.evaluate(() => {
    window.TagSuggestLive.forInboxItem = (_dash, entry) => ['one', 'two', 'three']
      .map((n) => ({ tag: `${n}-${entry.id}`, pattern: `p-${n}-${entry.id}`, reason: { kind: 'catalogue' } }));
    window.dashboardInstance.inbox.render();
  });
  const more = item(page, 'Read one').locator('[data-inbox-offers-more]');
  await expect(more).toHaveText('+2');
  await more.click();
  const pop = page.locator('.tag-offer-pop');
  await expect(pop.locator('.tag-offer-pop-row')).toHaveCount(3);
  await pop.getByRole('button', { name: 'Add #two-ib-read' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ op: 'tag', ids: ['ib-read'], addTags: ['two-ib-read'] });
  await expect(pop).toHaveCount(0);
});

test('own tags that do not fit fold into +n, which lists them; the offer stays', async ({ page }) => {
  await openWithOffers(page);
  await page.evaluate(() => {
    const inbox = window.dashboardInstance.inbox;
    const entry = (inbox.items || inbox._items || []).find((x) => x.id === 'ib-read');
    entry.tags = ['alpha-long-tag', 'beta-long-tag', 'gamma-long-tag', 'delta-long-tag', 'epsilon-long-tag', 'zeta-long-tag'];
    inbox.render();
  });
  await expect(offer(page, 'Read one')).toBeVisible();
  const own = item(page, 'Read one').locator('.inbox-row-tag--more');
  await expect(own).toBeVisible();
  await own.click();
  const tags = page.locator('.tag-offer-pop .tag-offer-pop-tag');
  await expect(tags.first()).toBeVisible();
  expect(await tags.count()).toBe(Number((await own.textContent()).replace('+', '')));
  await expect(page.locator('[data-lvs-drawer="inbox"]')).toBeHidden();
});
