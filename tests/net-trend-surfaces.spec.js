// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, prepareDashboardInteraction, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The response-time sparkline on the preview card and in the Network tests
 * widget. Both read what the app already holds: the card the bulk answer of
 * /api/net/checks the row chips use, the widget /api/net/dashboard. A hover on
 * the card asks the server for nothing.
 */

const SPARK = [120, 130, 125, 140, 135, 150, 145, 160, 155, 170, 165, 180, 175, 190, 185, 200, 195, 210, 205, 220, 215, 230, 225, 240];
const NOW = () => Date.now();

function item(id, type, label, spark) {
  return {
    pageId: 1, url: 'https://trend.example/', name: 'Trend', checkId: id, type, label, enabled: true, muted: false,
    state: { at: NOW(), ok: true, ms: 240 }, spark,
  };
}

async function openDashboard(page) {
  await markWhatsNewSeen(page);
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
  await dismissOnboardingIfPresent(page);
  await dismissBlockingOverlays(page);
}

test.describe('response-time trends on the dashboard', () => {
  test('the preview card lists the checks with their last day, from memory, and the pinned card goes to the Tests tab', async ({ page }) => {
    await openDashboard(page);
    const result = await page.evaluate(async ({ spark }) => {
      const d = window.dashboardInstance;
      const items = [
        { pageId: 1, url: 'https://trend.example/', name: 'Trend', checkId: 'a1a1a1a1a1a1', type: 'http', label: 'HTTP', enabled: true, state: { at: Date.now(), ok: true, ms: 240 }, spark },
        { pageId: 1, url: 'https://trend.example/', name: 'Trend', checkId: 'b2b2b2b2b2b2', type: 'tcp', label: 'TCP 443', enabled: true, state: { at: Date.now(), ok: true, ms: 31 }, spark: null },
        { pageId: 1, url: 'https://trend.example/', name: 'Trend', checkId: 'c3c3c3c3c3c3', type: 'ping', label: 'Ping', enabled: true, state: { at: Date.now(), ok: true, ms: 12 }, spark },
        { pageId: 1, url: 'https://trend.example/', name: 'Trend', checkId: 'd4d4d4d4d4d4', type: 'dns', label: 'DNS', enabled: true, state: { at: Date.now(), ok: true, ms: 8 }, spark },
      ];
      d.netBadges.index(items);
      await d.netBadges.ensureModel();
      let requests = 0;
      const realFetch = window.fetch;
      window.fetch = (...args) => { requests += 1; return realFetch.apply(window, args); };
      const bookmark = { name: 'Trend', url: 'https://trend.example/', pageId: 1 };
      const card = d.preview.ensureBookmarkPreviewCard();
      d.preview.paintPreviewCard(card, d.preview.buildPreviewPayload(bookmark, { title: 'Trend', url: bookmark.url }), { mode: 'peek' });
      window.fetch = realFetch;
      const peek = {
        requests,
        labels: [...card.querySelectorAll('.bookmark-preview-card-facts dt')].map((el) => el.textContent),
        sparks: card.querySelectorAll('.bookmark-preview-card-facts svg[data-net-spark]').length,
        footNet: card.querySelector('[data-preview-action="net"]').hidden,
      };
      d.preview.paintPreviewCard(card, d.preview.buildPreviewPayload(bookmark, { title: 'Trend', url: bookmark.url }), { mode: 'pinned' });
      const pinnedNetHidden = card.querySelector('[data-preview-action="net"]').hidden;
      window.__opened = [];
      d.netBadges.openTests = (...args) => window.__opened.push(args);
      d.previewCardElement._previewContext = { bookmark };
      card.querySelector('[data-preview-action="net"]').click();
      return { peek, pinnedNetHidden, opened: window.__opened };
    }, { spark: SPARK });

    expect(result.peek.requests).toBe(0);
    // Three checks and a count: the fourth is "+1", the one without a day has a value and no line.
    expect(result.peek.labels.slice(0, 3)).toEqual(['HTTP', 'TCP 443', 'Ping']);
    expect(result.peek.labels).toContain('+1 more checks');
    expect(result.peek.sparks).toBe(2);
    // Peek has no footer to click; the pinned card does.
    expect(result.pinnedNetHidden).toBe(false);
    expect(result.opened).toEqual([[1, 'https://trend.example/']]);
  });

  test('a bookmark without checks has no check rows and no button', async ({ page }) => {
    await openDashboard(page);
    const out = await page.evaluate(async () => {
      const d = window.dashboardInstance;
      d.netBadges.index([]);
      const bookmark = { name: 'Plain', url: 'https://plain.example/', pageId: 1 };
      const card = d.preview.ensureBookmarkPreviewCard();
      d.preview.paintPreviewCard(card, d.preview.buildPreviewPayload(bookmark, { title: 'Plain', url: bookmark.url }), { mode: 'pinned' });
      return {
        sparks: card.querySelectorAll('svg[data-net-spark]').length,
        netHidden: card.querySelector('[data-preview-action="net"]').hidden,
      };
    });
    expect(out.sparks).toBe(0);
    expect(out.netHidden).toBe(true);
  });

  test('the Network tests widget draws a line for a check that has a day of readings and none for one that does not', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.route((url) => url.pathname === '/api/net/dashboard', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true, fetchedAt: NOW(), counts: { total: 2, down: 0, warn: 0, slow: 0, gone: 0 },
        items: [
          { ...item('a1a1a1a1a1a1', 'tcp', 'TCP 443', SPARK), name: 'Nextcloud', beat: [] },
          { ...item('b2b2b2b2b2b2', 'tls', 'TLS', null), name: 'Gitea', beat: [] },
        ],
      }),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(async () => {
      const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
      const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
      await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [{ type: 'nettests', title: 'Network tests', config: { checks: ['a1a1a1a1a1a1', 'b2b2b2b2b2b2'] } }] }) });
    });
    try {
      await page.reload();
      await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
      const widget = page.locator('.dashboard-widget[data-widget-type="nettests"]');
      await expect(widget.locator('.netw-row')).toHaveCount(2);
      await expect(widget.locator('[data-net-check="a1a1a1a1a1a1"] svg[data-net-spark]')).toHaveCount(1);
      await expect(widget.locator('[data-net-check="b2b2b2b2b2b2"] svg[data-net-spark]')).toHaveCount(0);
    } finally {
      await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
      }).catch(() => {});
    }
  });
});
