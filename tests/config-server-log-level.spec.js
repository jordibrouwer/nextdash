// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Puts the log settings back to their defaults before a test reads them.
 *
 * Settings live on the server and survive a reload, so a test that switched a
 * channel on would otherwise decide what the next one starts from. Each test
 * states its own precondition instead of depending on the order they run in.
 */
async function resetLogSettings(page) {
    await page.evaluate(async () => {
        // Through nextDashFetch, which is what the app writes with: a bare
        // fetch misses the write token and comes back 401, leaving the previous
        // test's channels in place.
        await window.nextDashFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverLogLevel: '', activityChannels: ['mutate', 'status'], activityOpenDetail: '',
            }),
        });
        // The panel renders from the in-memory copy, which a write to the
        // server does not refresh — a previous test's channels would otherwise
        // still be what this one draws.
        const settings = window.dashboardInstance.settings;
        if (settings) {
            settings.serverLogLevel = '';
            settings.activityChannels = ['mutate', 'status'];
            settings.activityOpenDetail = '';
        }
    });
}

/**
 * Opens Data & backups → Server log, the way the tab is reached in the app.
 */
async function openServerLogTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await resetLogSettings(page);
    await page.evaluate(async () => {
        const config = window.dashboardInstance.config;
        await config.openConfigView('data-backups');
        const c = config.instance || config;
        c.dbTab = 'logs';
        c.render();
    });
}

test('the detail level is chosen in the app and reaches the server', async ({ page }) => {
    await openServerLogTab(page);

    const level = page.locator('[data-log-select="detail"]');
    await expect(level).toBeVisible({ timeout: 15_000 });

    await level.selectOption('debug');
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).serverLogLevel;
    }), { timeout: 15_000 }).toBe('debug');
});

test('the floor note says what is being kept, apart from the display filter', async ({ page }) => {
    await openServerLogTab(page);

    const note = page.locator('[data-log-floor-note]');
    await expect(note).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-log-select="detail"]').selectOption('warn');
    await expect(note).toContainText(/quiet/i, { timeout: 15_000 });
});

test('the detail level says what the container log is doing, as it changes', async ({ page }) => {
    await openServerLogTab(page);

    const live = page.locator('[data-log-detail-live]');
    await expect(live).toBeVisible({ timeout: 15_000 });
    await expect(live).toContainText(/docker logs/i);

    // The line follows the select immediately — that the change needs no
    // restart is the thing this control is easy to be wrong about.
    await page.locator('[data-log-select="detail"]').selectOption('debug');
    await expect(live).toContainText(/every step|elke stap/i, { timeout: 15_000 });

    await page.locator('[data-log-select="detail"]').selectOption('warn');
    await expect(live).toContainText(/problems only|alleen problemen/i, { timeout: 15_000 });
});

test('an activity channel can be switched on and is remembered', async ({ page }) => {
    await openServerLogTab(page);

    const health = page.locator('[data-activity-channel="health"]');
    await expect(health).toBeVisible({ timeout: 15_000 });
    await expect(health).not.toBeChecked();

    await health.check();
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).activityChannels || [];
    }), { timeout: 15_000 }).toContain('health');
});

test('the activity trail can be put back to its defaults', async ({ page }) => {
    await openServerLogTab(page);

    // Nothing to reset while the list is untouched, matching the ↺ elsewhere
    // in config: it appears only when a value differs from the default.
    const reset = page.locator('[data-activity-reset]');
    await expect(page.locator('[data-activity-channel="mutate"]')).toBeVisible({ timeout: 15_000 });
    await expect(reset).toBeHidden();

    // Move away from the defaults in both directions at once: one channel on
    // that is off by default, one off that is on.
    await page.locator('[data-activity-channel="health"]').check();
    await page.locator('[data-activity-channel="mutate"]').uncheck();
    await expect(reset).toBeVisible({ timeout: 15_000 });

    await reset.click();

    await expect(page.locator('[data-activity-channel="mutate"]')).toBeChecked({ timeout: 15_000 });
    await expect(page.locator('[data-activity-channel="status"]')).toBeChecked();
    await expect(page.locator('[data-activity-channel="health"]')).not.toBeChecked();
    await expect(reset).toBeHidden();

    // And the server was told, not just the screen.
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).activityChannels || [];
    }), { timeout: 15_000 }).toEqual(['mutate', 'status']);
});

test('the open-detail level is disabled until Bookmarks opened is on', async ({ page }) => {
    await openServerLogTab(page);

    const openChannel = page.locator('[data-activity-channel="open"]');
    const detail = page.locator('[data-activity-open-detail]');
    await expect(openChannel).toBeVisible({ timeout: 15_000 });
    await expect(openChannel).not.toBeChecked();
    await expect(detail).toBeDisabled();
    // Basic is the default value underneath, even while greyed out — turning
    // Open on must not silently reset a choice nobody made yet.
    await expect(detail).toHaveValue('basic');

    await openChannel.check();
    await expect(detail).toBeEnabled({ timeout: 15_000 });

    await detail.selectOption('full');
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).activityOpenDetail;
    }), { timeout: 15_000 }).toBe('full');

    // Turning Open back off greys the select out again rather than clearing
    // the choice, the same as the channel checkboxes leave each other alone.
    await openChannel.uncheck();
    await expect(detail).toBeDisabled({ timeout: 15_000 });
    await expect(detail).toHaveValue('full');
});

// One of the five Phase 3 channels, picked because a search that starts and
// ends is easy to drive without touching a bookmark. The other four follow
// the same gate (window.nextdashChannelOn), read from this same setting.
test('a search is only sent to the server once the search channel is on', async ({ page }) => {
    await openServerLogTab(page);

    const requests = [];
    await page.route('**/api/track-search', async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    });

    const searchChannel = page.locator('[data-activity-channel="search"]');
    await expect(searchChannel).toBeVisible({ timeout: 15_000 });
    await expect(searchChannel).not.toBeChecked();

    // Off: leave Config, search, and close it. Nothing should be sent.
    await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
    await page.keyboard.press('>');
    await page.keyboard.type('zzz-search-off', { delay: 10 });
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(requests.length).toBe(0);

    // On: reopen Config, tick the box, and repeat the same round trip.
    await page.evaluate(async () => {
        const config = window.dashboardInstance.config;
        await config.openConfigView('data-backups');
        const c = config.instance || config;
        c.dbTab = 'logs';
        c.render();
    });
    await expect(searchChannel).toBeVisible({ timeout: 15_000 });
    await searchChannel.check();
    await page.evaluate(() => window.dashboardInstance.config.closeConfigView());

    await page.keyboard.press('>');
    await page.keyboard.type('zzz-search-on', { delay: 10 });
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');

    await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(1);
    expect(requests[0].query.toLowerCase()).toContain('search-on');
});

// '<' opens config — one of the global shortcuts nextdashRecordKey aggregates
// rather than sending per press. pagehide is the flush this drives, since a
// real 30s interval is too slow for a test.
test('a real shortcut is aggregated and flushed to track-keys', async ({ page }) => {
    await openServerLogTab(page);

    const requests = [];
    await page.route('**/api/track-keys', async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    });

    const keysChannel = page.locator('[data-activity-channel="keys"]');
    await expect(keysChannel).toBeVisible({ timeout: 15_000 });
    await keysChannel.check();
    await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 5_000 }).toBe('bookmarks');

    await page.keyboard.press('<');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 5_000 }).toBe('config');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

    await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(1);
    expect(requests[0].keys).toHaveProperty('<');
});

// The real per-category toggle, not a settings write — this is the click a
// reader actually makes.
test('collapsing a category through the real toggle sends track-nav', async ({ page }) => {
    await openServerLogTab(page);

    const requests = [];
    await page.route('**/api/track-nav', async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    });

    const navChannel = page.locator('[data-activity-channel="nav"]');
    await expect(navChannel).toBeVisible({ timeout: 15_000 });
    await navChannel.check();
    await page.evaluate(() => window.dashboardInstance.config.closeConfigView());

    const title = page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .category-title').first();
    await expect(title).toBeVisible({ timeout: 10_000 });
    await title.click();

    // Leaving Config to reach the grid is its own "view" nav line, sent
    // before this click — the category toggle is whichever one names it.
    await expect.poll(
        () => requests.some((r) => r.action === 'category-collapse' || r.action === 'category-expand'),
        { timeout: 15_000 },
    ).toBe(true);
});
