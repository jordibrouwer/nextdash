const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('../e2e-helpers');

// One item per row kind the redesign draws differently: unread (with preview,
// note, tags and a source, so every panel section has something), read, snoozed.
function inboxItems() {
  const now = Date.now();
  return [
    { id: 'ib-unread', url: 'https://example.com/unread', domain: 'example.com', title: 'Unread one', addedAt: now - 3600_000,
      previewDesc: 'A page about things', note: 'Read this first', tags: ['work'], source: 'extension' },
    { id: 'ib-read', url: 'https://example.com/read', domain: 'example.com', title: 'Read one', addedAt: now - 7200_000, readAt: now - 600_000 },
    { id: 'ib-snoozed', url: 'https://example.com/snoozed', domain: 'example.com', title: 'Snoozed one', addedAt: now - 86400_000,
      snoozedUntil: now + 86400_000 },
  ];
}

async function stubInbox(page, items = inboxItems()) {
  await page.route('**/api/inbox', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) });
  });
}

async function openInboxWith(page, items = inboxItems()) {
  await stubInbox(page, items);
  await markWhatsNewSeen(page);
  await page.goto('/');
  await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
  await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
  await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
  await page.locator('#page-nav-inbox-btn').click();
  await page.waitForSelector('.inbox-layout .inbox-item', { timeout: 15_000 });
}

// Exact: "Read one" is also a substring of "Unread one".
const item = (page, title) => page.locator('.inbox-item', {
  has: page.locator('.inbox-item-title', { hasText: new RegExp(`^${title}$`) }),
});

module.exports = { inboxItems, stubInbox, openInboxWith, item };
