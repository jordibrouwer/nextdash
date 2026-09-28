const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * One bookmark's health, in large: opened from the side panel's Health tab,
 * the row menu or Shift+H, and drawn from the report and /api/health/history.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;
const modal = (page) => page.locator('#app-modal.show [data-bm-health-large]');
const card = (page, name) => modal(page).locator(`[data-bm-large-card="${name}"]`);
const tab = (page, name) => modal(page).locator(`[data-bm-large-tab="${name}"]`);

async function stubHistory(page, { samples = null, days = null } = {}) {
  const now = Date.now();
  const s = samples ?? [
    { t: now - 3 * HOUR, u: true, p: 120, c: 200 },
    { t: now - 2 * HOUR, u: true, p: 180, c: 200 },
    { t: now - 90 * 60000, u: false, c: 502 },
    { t: now - HOUR, u: false },
    { t: now - 5 * DAY, u: true, p: 90, c: 301 },
  ];
  const start = new Date(now - 40 * DAY); start.setUTCHours(0, 0, 0, 0);
  // As the server serves them: the folded days, and the checks kept folded in.
  const dayOf = (ms) => { const x = new Date(ms); x.setUTCHours(0, 0, 0, 0); return x.getTime(); };
  const byDay = new Map();
  s.forEach((x) => {
    const e = byDay.get(dayOf(x.t)) || { d: dayOf(x.t), n: 0, u: 0, p: 0 };
    e.n += 1;
    if (x.u) e.u += 1;
    byDay.set(e.d, e);
  });
  const d = days ?? [{ d: start.getTime(), n: 20, u: 19, p: 200 }, { d: start.getTime() + DAY, n: 20, u: 20, p: 150 }, ...byDay.values()];
  const asked = [];
  await page.route('**/api/health/history?**', (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ url: 'x', samples: s, days: d, sampleDays: 30, dayDays: 90 }) });
  });
  return asked;
}

async function open(page) {
  // The broken bookmark (the first) is a monitored one here.
  return openBookmarksWithHealth(page, (issues) => issues.map((issue, i) => (i === 0 ? {
    ...issue,
    monitor: true,
    monitorStats: {
      intervalMinutes: 5, totalChecks: 5,
      uptime24h: { ratio: 0.5, samples: 4 }, uptime7d: { ratio: 0.8, samples: 5 }, uptime30d: { ratio: 0.8, samples: 5 },
      incidents: [{ start: Date.now() - 90 * 60000, durationMs: 45 * 60000, checks: 2, reason: 'HTTP 502' }],
    },
  } : issue)), { view: 'library' });
}

const row = (page, name) => page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first();

test.describe('bookmark health, in large', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('nextdash.bm.panelTab');
        localStorage.removeItem('nextdash.bm.healthLargeTab');
      } catch {}
    });
  });

  test('Open charts in the Health tab opens it, every card filled from the checks', async ({ page }) => {
    const asked = await stubHistory(page);
    const { bookmarks } = await open(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await row(page, bookmarks[0].name).click();
    const drawer = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
    await drawer.locator('[data-bm-tab-panel="health"]').click();
    await drawer.locator('[data-bm-panel-action="health-large"]').click();
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => asked.length).toBe(1);
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    for (const name of ['uptime', 'response', 'days', 'codes', 'hours', 'incidents', 'score', 'cert', 'kept', 'checks']) {
      await expect(card(page, name)).toHaveCount(1);
    }
    await expect(card(page, 'uptime')).toContainText('50%');
    // 90 days from the daily summaries as served, the checks folded in: 42 of 45.
    await expect(card(page, 'uptime')).toContainText('93.3%');
    const codes = await card(page, 'codes').locator('.bm-health-large-codes > div').evaluateAll((rows) =>
      rows.map((r) => [r.firstElementChild.textContent.trim(), r.lastElementChild.textContent.trim()]));
    expect(codes).toEqual([['2xx', '2'], ['3xx', '1'], ['4xx', '0'], ['5xx', '1'], ['no answer', '1']]);
    // It opens on the last 30 days: a bar a day.
    await expect(modal(page).locator('[data-bm-large-range]')).toHaveValue('30');
    await expect(card(page, 'days').locator('rect[data-tone]')).toHaveCount(30);
    await expect(card(page, 'hours').locator('rect')).toHaveCount(720);
    await expect(card(page, 'hours').locator('rect[data-tone="bad"]')).not.toHaveCount(0);
    await expect(card(page, 'checks').locator('.bm-health-large-ticks i')).toHaveCount(4);
    await expect(card(page, 'incidents')).toContainText('HTTP 502');
    // One screen: nothing to scroll.
    const m = await page.locator('#app-modal.show .modal-body').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh).toBeLessThanOrEqual(m.ch + 1);
  });

  // Drawn at the width they are shown at: a chart stretched to its card
  // pulls its dates and dots out of shape.
  test('the charts are drawn at their own width, not stretched', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    // Within one percent: a card that settles a few pixels after the last
    // measurement is not a stretch anyone sees; 320 drawn at 578 was.
    const ratios = () => modal(page).locator('svg.bm-health-large-line, svg.bm-health-large-days, svg.bm-health-large-heat')
      .evaluateAll((svgs) => svgs.map((svg) => Math.abs(svg.getBoundingClientRect().width / svg.viewBox.baseVal.width - 1)));
    await expect.poll(async () => Math.max(...(await ratios()).slice(0, 2))).toBeLessThanOrEqual(0.01);
    // The hours chart waits on the Checks tab, measured once it is shown.
    await tab(page, 'checks').click();
    await expect.poll(async () => Math.abs((await ratios())[2])).toBeLessThanOrEqual(0.01);
    expect((await ratios()).length).toBe(3);
  });

  test('the period is chosen from a list, and every chart follows it', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    const range = modal(page).locator('[data-bm-large-range]');
    const options = await range.locator('option').evaluateAll((os) => os.map((o) => o.value));
    expect(options).toEqual(['today', '7', '14', '30', '90']);

    await range.selectOption('7');
    await expect(modal(page)).toHaveAttribute('data-range', '7');
    await expect(card(page, 'days').locator('rect[data-tone]')).toHaveCount(7);
    await expect(card(page, 'hours').locator('rect')).toHaveCount(7 * 24);
    // The check five days ago is in; nothing older.
    await expect(card(page, 'codes')).toContainText('3xx');

    await range.selectOption('today');
    await expect(card(page, 'days').locator('rect[data-tone]')).toHaveCount(24);
    await expect(card(page, 'hours').locator('rect')).toHaveCount(24);
    const codesToday = await card(page, 'codes').locator('.bm-health-large-codes > div').evaluateAll((rows) =>
      rows.map((r) => r.lastElementChild.textContent.trim()));
    expect(codesToday[1]).toBe('0'); // the 3xx was five days ago

    await range.selectOption('90');
    await expect(card(page, 'days').locator('rect[data-tone]')).toHaveCount(90);
    // Past the 30 days of single checks, the chart says how far they reach.
    await expect(card(page, 'codes')).toContainText('last 30 days');

    // → keeps the period chosen; opening afresh starts on 30 again.
    await page.keyboard.press('ArrowRight');
    await expect(modal(page)).toHaveAttribute('data-range', '90');
    await page.keyboard.press('Escape');
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-range', '30');
  });

  test('the period list sits level with the buttons beside it', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    const boxes = await modal(page).locator('.bm-health-large-buttons').evaluate((host) =>
      [...host.querySelectorAll('select, button, a')].map((el) => {
        const r = el.getBoundingClientRect();
        return { mid: r.top + r.height / 2, h: r.height };
      }));
    const mids = boxes.map((b) => b.mid);
    expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(1);
    const heights = boxes.map((b) => b.h);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  });

  test('the charts read out their values under the pointer', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    const tip = page.locator('#app-modal.show .bm-large-tip');
    await tab(page, 'checks').click();
    const down = card(page, 'hours').locator('rect[data-tone="bad"]').first();
    await down.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/down/);
    await tab(page, 'overview').click();
    await card(page, 'codes').locator('.bm-health-large-codes > div').first().hover();
    await expect(tip).toContainText(/^2xx: 2/);
    await card(page, 'response').locator('.is-point').first().hover({ force: true });
    await expect(tip).toContainText(/ms$/);
  });

  test('the row menu and Shift+H open it too; → goes to the next bookmark', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toBeVisible();
    await expect(page.locator('#app-modal.show .modal-title, #app-modal.show #modal-title').first()).toContainText(bookmarks[0].name);
    const before = await page.evaluate(() => window.dashboardInstance.config._bmLargeKey);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._bmLargeKey)).not.toBe(before);
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await row(page, bookmarks[0].name).click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+H');
    await expect(modal(page)).toBeVisible();
  });

  test('without checks, a chart says so and offers Monitor', async ({ page }) => {
    await stubHistory(page, { samples: [], days: [] });
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await row(page, bookmarks[1].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    await expect(card(page, 'hours')).toContainText(/Not enough checks/);
    await expect(card(page, 'hours').locator('[data-bm-large-action="monitor"]')).toHaveCount(1);
  });

  test('two tabs: Overview first, Checks remembered for next time', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    await expect(tab(page, 'overview')).toHaveAttribute('aria-selected', 'true');
    for (const name of ['uptime', 'response', 'days', 'codes', 'incidents', 'score']) await expect(card(page, name)).toBeVisible();
    for (const name of ['hours', 'cert', 'kept', 'checks', 'log']) await expect(card(page, name)).toBeHidden();
    await tab(page, 'checks').click();
    for (const name of ['hours', 'cert', 'kept', 'checks', 'log']) await expect(card(page, name)).toBeVisible();
    await expect(card(page, 'uptime')).toBeHidden();
    // A new period keeps the tab it was chosen on.
    await modal(page).locator('[data-bm-large-range]').selectOption('7');
    await expect(card(page, 'log')).toBeVisible();
    await page.keyboard.press('Escape');
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(tab(page, 'checks')).toHaveAttribute('aria-selected', 'true');
    await expect(card(page, 'log')).toBeVisible();
  });

  test('every check of the period: newest first, searched, failures alone, exported', async ({ page }) => {
    await stubHistory(page);
    const { bookmarks } = await open(page);
    await row(page, bookmarks[0].name).click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="health-large"]').click();
    await expect(modal(page)).toHaveAttribute('data-loading', '0');
    await tab(page, 'checks').click();
    const log = card(page, 'log');
    const rows = log.locator('tbody tr');
    await expect(rows).toHaveCount(5);
    // Newest first: an hour ago, no answer at all.
    await expect(rows.first()).toContainText('no answer');
    await expect(rows.first()).toHaveClass(/is-down/);
    await expect(log.locator('[data-bm-large-log-note]')).toHaveText('5 checks');

    await log.locator('[data-bm-large-log-errors]').click();
    await expect(rows).toHaveCount(2);
    await log.locator('[data-bm-large-log-q]').fill('502');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('HTTP 502');
    await log.locator('[data-bm-large-log-errors]').click();
    await log.locator('[data-bm-large-log-q]').fill('301');
    await expect(rows).toHaveCount(1);
    await log.locator('[data-bm-large-log-q]').fill('zzz');
    await expect(rows).toHaveText(['No checks match.']);

    // The list scrolls inside its card, not the modal.
    const overflow = await log.locator('.bm-health-large-log-scroll').evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toBe('auto');

    // The download itself is the health module's, as from the side panel.
    await page.evaluate(() => {
      const health = window.dashboardInstance.config._bmHealthModule;
      health.downloadUrl = (href) => { window.__exported = href; };
    });
    await log.locator('[data-bm-large-action="export"]').click();
    await expect.poll(() => page.evaluate(() => window.__exported || '')).toContain('/api/health/history-export?url=');
    expect(await page.evaluate(() => decodeURIComponent(window.__exported))).toContain(bookmarks[0].url);
  });
});
