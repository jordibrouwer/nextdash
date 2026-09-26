const { test, expect } = require('./fixtures');
const { openInboxWith, item } = require('./helpers/inbox-report');

/**
 * The inbox tags dialog offers what the bookmark form offers: existing tags as
 * you type, and the suggestion engine's chips -- for one link and for a
 * ticked selection alike.
 */

// A predictable engine: each item gets one offer named after it.
async function stubSuggestions(page) {
  await page.evaluate(() => {
    const live = window.TagSuggestLive;
    live.forInboxItem = (_dash, entry) => [{ tag: `for-${entry.id}`, pattern: `p-${entry.id}`, source: 'domain', count: 1 }];
  });
}

const input = (page) => page.locator('#inbox-tags-modal-input');

test.describe('inbox tags dialog', () => {
  test('typing offers tags that already exist', async ({ page }) => {
    await openInboxWith(page);
    await item(page, 'Read one').locator('.inbox-item-title').click();
    await page.locator('[data-lvs-drawer="inbox"] [data-inbox-drawer-action="tags"]').click();
    await input(page).fill('wo');
    await expect(page.locator('.tag-ac-dropdown .tag-ac-item', { hasText: 'work' })).toBeVisible();
  });

  test('a suggestion chip for this link fills the field', async ({ page }) => {
    await openInboxWith(page);
    await stubSuggestions(page);
    await item(page, 'Read one').locator('.inbox-item-title').click();
    await page.locator('[data-lvs-drawer="inbox"] [data-inbox-drawer-action="tags"]').click();
    const chip = page.locator('#inbox-tags-modal-suggest .tag-suggest-chip-add', { hasText: '#for-ib-read' });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(input(page)).toHaveValue(/for-ib-read/);
  });

  test('a ticked selection gets the suggestions of its links', async ({ page }) => {
    await openInboxWith(page);
    await stubSuggestions(page);
    for (const title of ['Unread one', 'Read one']) {
      await item(page, title).hover();
      await item(page, title).locator('.inbox-item-check-input').check();
    }
    await page.locator('[data-inbox-selection="tags"]').click();
    const chips = page.locator('#inbox-tags-modal-suggest .tag-suggest-chip-add');
    await expect(chips.filter({ hasText: '#for-ib-unread' })).toBeVisible();
    await expect(chips.filter({ hasText: '#for-ib-read' })).toBeVisible();
    await input(page).fill('wo');
    await expect(page.locator('.tag-ac-dropdown .tag-ac-item', { hasText: 'work' })).toBeVisible();
  });
});
