// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The server log viewer on Logs → Server logs.
 *
 * Deliberately short: the buffer, parsing and retention are covered by Go tests
 * in log_buffer_test.go. What only a browser can show is that the tab renders
 * real lines, that clearing empties it, and that the refresh interval — the
 * only polling timer in config — is taken down when you leave.
 */
/**
 * Open the tab, optionally with collecting switched on.
 *
 * Capture is off on a fresh install, so a test that wants lines has to turn it
 * on the way a user would.
 */
/**
 * Open the gear's popover, the way a user reaches the settings that used to
 * be their own panel. A no-op if it is already open.
 */
async function openLogSettingsPopover(page) {
    const popover = page.locator('#config-log-settings-popover');
    if (await popover.isHidden()) {
        await page.locator('[data-log-settings-toggle]').click();
    }
    await expect(popover).toBeVisible();
    return popover;
}

async function openLogs(page, { capture = true, clear = false, maxEntries = 0 } = {}) {
    // One server is shared across the file, so the previous test's choice is
    // still persisted. Set the switch before the page loads, so the tab paints
    // from the state this test wants rather than the last one's. The entry cap
    // goes back too — 0 means "never chosen", which the server normalises to
    // the default, so a test that cares about the size starts from a clean slate.
    await page.request.post('/api/settings', {
        data: {
            serverLogEnabled: capture,
            serverLogRetentionMode: 'time',
            serverLogMaxEntries: maxEntries,
        },
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('logs'));
    await expect(page.locator('[data-log-output]')).toBeVisible();

    const toggle = page.locator('[data-log-toggle="capture"]');
    if (capture !== ((await toggle.getAttribute('aria-pressed')) === 'true')) {
        await toggle.click();
        await expect.poll(() => page.evaluate(async () =>
            (await (await nextDashFetch('/api/logs')).json()).capturing), { timeout: 10_000 }).toBe(capture);
    }
    // One server is shared across the file, so a previous test's lines are
    // still in the buffer. Tests that assert on what is *not* there start clean.
    if (clear) {
        await page.evaluate(async () => {
            await nextDashFetch('/api/logs', { method: 'DELETE' });
            // Awaited rather than clicking Refresh: the click returns before
            // the fetch behind it lands, and the next assertion would race it.
            await window.dashboardInstance.config.loadServerLog({ reset: true });
        });
    }
    if (capture) {
        // Give the server something to have logged, then pull it in.
        await page.evaluate(async () => {
            await fetch('/api/pages');
            await window.dashboardInstance.config.loadServerLog({ reset: true });
        });
    }
}

test.describe('Logs → Server logs', () => {
    test('shows captured lines, with tiles and controls', async ({ page }) => {
        await openLogs(page);

        // Loading the page necessarily logs requests, so there is always
        // something to show.
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);
        await expect(page.locator('#config-log-tiles .config-tile')).toHaveCount(3);

        // The controls the feature is made of: the level filter stays on the
        // toolbar, the rest live behind the gear.
        await expect(page.locator('[data-log-select="level"]')).toBeVisible();
        for (const action of ['refresh', 'copy', 'download', 'clear']) {
            await expect(page.locator(`[data-log-action="${action}"]`)).toBeVisible();
        }
        await openLogSettingsPopover(page);
        for (const kind of ['interval', 'retention']) {
            await expect(page.locator(`[data-log-select="${kind}"]`)).toBeVisible();
        }
    });

    test('every line carries its own number, and a filter does not renumber them', async ({ page }) => {
        await openLogs(page, { clear: true });
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(2);

        const numbers = () => page.locator('.config-log-seq').allTextContents();
        const before = (await numbers()).map(Number);
        expect(before.length).toBeGreaterThan(2);
        // Counting up, one per line. Clearing empties the buffer but keeps
        // the count going, so a reader polling from an older number misses
        // nothing: the first line after a clear is not necessarily 1.
        expect(before).toEqual(before.map((_, i) => before[0] + i));

        // The number belongs to the line, not to its place on screen: what
        // survives a filter keeps the number it had.
        const kept = before.at(-1);
        await page.locator('[data-log-search]').fill(String(await page
            .locator('.config-log-line')
            .last()
            .locator('.config-log-message')
            .innerText()).slice(0, 20));
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);
        expect((await numbers()).map(Number)).toContain(kept);
    });

    test('the level filter narrows what is listed', async ({ page }) => {
        await openLogs(page, { clear: true });
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);

        // Nothing since the clear has failed, so asking for errors empties the
        // list — which also proves the filter reaches the server rather than
        // just hiding rows that were already fetched.
        await page.locator('[data-log-select="level"]').selectOption('error');
        await expect.poll(() => page.locator('.config-log-line--info').count()).toBe(0);

        await page.locator('[data-log-select="level"]').selectOption('');
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);
    });

    test('Activity only shows what was done, not the requests around it', async ({ page }) => {
        await openLogs(page, { clear: true });
        // Something the user did, alongside the request lines the page load
        // produced anyway. Saving categories is logged as an activity line.
        await page.evaluate(async () => {
            const pageId = window.dashboardInstance.currentPageId;
            const current = await (await fetch(`/api/categories?page=${pageId}`)).json();
            // Saved back unchanged: the point is that the save is logged as an
            // activity line, not what it writes.
            // Through nextDashFetch, which is what the app writes with: a bare
            // fetch misses the write token and comes back 401.
            await window.nextDashFetch(`/api/categories?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Array.isArray(current) ? current : []),
            });
            await window.dashboardInstance.config.loadServerLog({ reset: true });
        });
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(1);

        await page.locator('[data-log-select="level"]').selectOption('activity');

        // Every remaining line is an activity line — the filter reaches the
        // server, which is what makes it different from typing "activity" into
        // the search box over lines already fetched.
        // Trail lines carry their channel now, not the word "activity": the
        // JSON moved to the trail file and the log line became a sentence
        // under the channel it belongs to.
        const channels = ['mutate', 'status', 'open', 'security', 'health', 'sources',
            'feeds', 'archive', 'backup', 'store', 'widgets', 'notify'];
        // Polled on the lines themselves: the unfiltered list stays on screen
        // until the filtered answer arrives, and read in between it failed
        // on the request lines it was about to drop.
        await expect.poll(async () => {
            const sources = await page.evaluate(() =>
                [...document.querySelectorAll('.config-log-line')].map((el) => el.textContent || ''));
            return sources.filter((text) => !channels.some((c) => text.includes(c)) || text.includes('GET /api/'))
                .concat(sources.length ? [] : ['(no lines)']);
        }, { timeout: 10_000 }).toEqual([]);

        // The one line of explanation appears with it, and goes away again.
        await expect(page.locator('[data-log-activity-note]')).toBeVisible();
        await page.locator('[data-log-select="level"]').selectOption('');
        await expect(page.locator('[data-log-activity-note]')).toBeHidden();
    });

    test('clearing empties the buffer on the server', async ({ page }) => {
        await openLogs(page);
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(1);

        await page.locator('[data-log-action="clear"]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();

        // The DELETE is itself logged, so "empty" means down to a line or two
        // rather than zero.
        await expect.poll(() => page.evaluate(async () => {
            const res = await nextDashFetch('/api/logs');
            return (await res.json()).stats.total;
        }), { timeout: 10_000 }).toBeLessThan(5);
        await expect.poll(() => page.locator('.config-log-line').count()).toBeLessThan(5);
    });

    test('collecting is off until switched on, and stopping keeps what is held', async ({ page }) => {
        await openLogs(page, { capture: false, clear: true });

        // Off by default, so an install nobody debugs pays nothing for it.
        await expect(page.locator('[data-log-toggle="capture"]')).toHaveAttribute('aria-pressed', 'false');
        // The empty state says why the list is empty. Asserted on the rendered
        // string rather than the DOM node: these tests share one server, so
        // whether any lines survive the clear depends on what ran before.
        expect(await page.evaluate(() => {
            window.dashboardInstance.config._logLines = [];
            return window.dashboardInstance.config.renderServerLogLines();
        })).toContain('Not collecting');

        await page.locator('[data-log-toggle="capture"]').click();
        await expect(page.locator('[data-log-toggle="capture"]')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).serverLogEnabled), { timeout: 10_000 }).toBe(true);
        await page.evaluate(() => fetch('/api/pages'));
        await page.locator('[data-log-action="refresh"]').click();
        await expect.poll(() => page.locator('.config-log-line').count()).toBeGreaterThan(0);

        // Stopping halts capture without discarding what is already there.
        await page.locator('[data-log-toggle="capture"]').click();
        await expect.poll(() => page.evaluate(async () =>
            (await (await nextDashFetch('/api/logs')).json()).capturing), { timeout: 10_000 }).toBe(false);

        const total = () => page.evaluate(async () => (await (await nextDashFetch('/api/logs')).json()).stats.total);
        const before = await total();
        expect(before).toBeGreaterThan(0);
        for (let i = 0; i < 5; i++) await page.evaluate(() => fetch('/api/pages'));
        expect(await total()).toBe(before);
    });

    test('recording with the refresh off says so, and says where the setting is', async ({ page }) => {
        await openLogs(page, { capture: false });
        const note = page.locator('[data-log-refresh-note]');
        // Not recording: nothing to warn about, whatever the interval says.
        await expect(note).toBeHidden();

        await page.locator('[data-log-toggle="capture"]').click();
        await expect(note).toBeVisible();
        await expect(note).toContainText('Refresh');

        // An interval answers it, so the note goes.
        await openLogSettingsPopover(page);
        await page.locator('[data-log-select="interval"]').selectOption('5');
        await expect(note).toBeHidden();

        await page.locator('[data-log-select="interval"]').selectOption('0');
        await expect(note).toBeVisible();

        // Stopping answers it too: an idle view over a log nobody is filling
        // is not a fault.
        await page.keyboard.press('Escape');
        await page.locator('[data-log-toggle="capture"]').click();
        await expect(note).toBeHidden();
    });

    test('the two caps are exclusive: only one control is live at a time', async ({ page }) => {
        await openLogs(page);
        await openLogSettingsPopover(page);

        const age = page.locator('[data-log-select="retention"]');
        const count = page.locator('[data-log-select="maxEntries"]');

        // Age is the default, so the entry count is inert.
        await expect(page.locator('[data-log-select="mode"]')).toHaveValue('time');
        await expect(age).toBeEnabled();
        await expect(count).toBeDisabled();

        // Changing the mode rebuilds the tab body (the live control has to
        // switch and the hint under them has to follow), which closes the
        // popover along with everything else in it — so it is reopened after
        // every mode change, same as after any other section repaint.
        await page.locator('[data-log-select="mode"]').selectOption('count');
        await openLogSettingsPopover(page);
        await expect(count).toBeEnabled();
        await expect(age).toBeDisabled();
        expect(await page.evaluate(() =>
            [...document.querySelectorAll('[data-log-select="maxEntries"] option')].map((o) => Number(o.value))
        )).toEqual([100, 500, 1000, 2500, 5000]);

        // The ring is resized to the choice, which is what makes the cap real
        // rather than a number the server merely stores.
        await page.locator('[data-log-select="maxEntries"]').selectOption('500');
        await expect.poll(() => page.evaluate(async () =>
            (await (await nextDashFetch('/api/logs')).json()).capacity), { timeout: 10_000 }).toBe(500);
        expect(await page.evaluate(async () => {
            const s = await (await fetch('/api/settings')).json();
            return [s.serverLogRetentionMode, s.serverLogMaxEntries];
        })).toEqual(['count', 500]);

        // Back to age, and the entry cap stops applying.
        await page.locator('[data-log-select="mode"]').selectOption('time');
        await expect.poll(() => page.evaluate(async () =>
            (await (await nextDashFetch('/api/logs')).json()).capacity), { timeout: 10_000 }).toBe(2000);
        await openLogSettingsPopover(page);
        await expect(page.locator('[data-log-select="maxEntries"]')).toBeDisabled();
    });

    // A slow poll that lands after a filter change is dropped, not appended:
    // its lines were read under the old filter and from an older position.
    test('a late answer from before a filter change is dropped', async ({ page }) => {
        await openLogs(page, { capture: false });
        const kept = await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            cfg.stopServerLogTimer();
            const real = window.fetch;
            const answer = (msg, nextSeq) => new Response(JSON.stringify({
                entries: [{ seq: nextSeq - 1, level: 'info', msg, time: new Date().toISOString() }],
                nextSeq, capacity: 2000, stats: null,
            }), { headers: { 'Content-Type': 'application/json' } });
            window.fetch = async (url, opts) => {
                const u = String(url);
                if (!u.startsWith('/api/logs')) return real(url, opts);
                if (u.includes('q=err')) return answer('fresh', 50);
                await new Promise((r) => setTimeout(r, 300));
                return answer('stale', 40);
            };
            const slow = cfg.loadServerLog();
            cfg.logQuery = 'err';
            await cfg.loadServerLog({ reset: true });
            await slow;
            window.fetch = real;
            return cfg._logLines.map((l) => l.msg);
        });
        expect(kept).toEqual(['fresh']);
    });

    test('the refresh timer stops when the tab is left', async ({ page }) => {
        await openLogs(page);
        const hasTimer = () => page.evaluate(() => !!window.dashboardInstance.config._logTimer);

        expect(await hasTimer()).toBe(false);
        await openLogSettingsPopover(page);
        await page.locator('[data-log-select="interval"]').selectOption('2');
        expect(await hasTimer()).toBe(true);

        // This is the whole risk of a polling view: leaving must take the timer
        // with it, or it keeps fetching behind whatever is opened next. Logs is
        // its own section now, so leaving means the rail, not a sub-tab.
        await page.locator('[data-config-section="data-backups"]').click();
        expect(await hasTimer()).toBe(false);

        await page.locator('[data-config-section="logs"]').click();
        await openLogSettingsPopover(page);
        await page.locator('[data-log-select="interval"]').selectOption('2');
        expect(await hasTimer()).toBe(true);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        expect(await hasTimer()).toBe(false);
    });

    test('the gear opens the settings popover, and Escape closes it and returns focus', async ({ page }) => {
        await openLogs(page);

        const gear = page.locator('[data-log-settings-toggle]');
        const popover = page.locator('#config-log-settings-popover');
        await expect(popover).toBeHidden();
        await expect(gear).toHaveAttribute('aria-expanded', 'false');

        await gear.click();
        await expect(popover).toBeVisible();
        await expect(gear).toHaveAttribute('aria-expanded', 'true');
        for (const kind of ['interval', 'mode', 'retention', 'maxEntries', 'detail']) {
            await expect(popover.locator(`[data-log-select="${kind}"]`)).toBeVisible();
        }
        // Recording is the one control that stayed in the toolbar: it decides
        // whether there is anything to look at, so it is not behind a gear.
        await expect(popover.locator('[data-log-toggle="capture"]')).toHaveCount(0);
        await expect(page.locator('.config-log-toolbar-actions [data-log-toggle="capture"]')).toBeVisible();

        // Escape closes it and hands focus back to the button that opened it.
        await page.keyboard.press('Escape');
        await expect(popover).toBeHidden();
        await expect(gear).toHaveAttribute('aria-expanded', 'false');
        await expect(gear).toBeFocused();
    });

    test('Activity trail opens from its tab button, with Open detail under Bookmarks opened', async ({ page }) => {
        await openLogs(page);

        await page.locator('[data-logs-tab="trail"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.logsTab)).toBe('trail');
        await expect(page.locator('.config-log-trail-card')).toHaveCount(3);

        // Open detail sits directly after the Bookmarks opened checkbox, not
        // tacked on after the whole channel list.
        const usageOrder = await page.evaluate(() => {
            const group = [...document.querySelectorAll('.config-log-trail-card')]
                .find((card) => card.querySelector('.config-panel-title')?.textContent === 'Usage');
            return [...group.querySelectorAll('[data-activity-channel], [data-activity-open-detail]')]
                .map((el) => el.getAttribute('data-activity-channel') || 'open-detail');
        });
        expect(usageOrder).toEqual(['open', 'open-detail', 'search', 'keys', 'nav', 'session']);
    });

    test('#config/logs/trail opens the Activity trail tab', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/logs/trail');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.logsTab),
            { timeout: 15_000 }).toBe('trail');
        await expect(page.locator('.config-log-trail-card')).toHaveCount(3);
    });
});

// A clear in another tab, or a restart, starts a new epoch: the viewer drops
// what it holds and reads the window again, rather than keeping cleared lines
// or adding replayed ones twice.
test('a new log epoch replaces the lines this tab holds', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    const replies = [
        { epoch: 'a', entries: [{ seq: 0, level: 'info', msg: 'old line' }], nextSeq: 1 },
        { epoch: 'b', entries: [], nextSeq: 1 },
        { epoch: 'b', entries: [{ seq: 0, level: 'info', msg: 'new line' }], nextSeq: 1 },
    ];
    let call = 0;
    await page.route(/\/api\/logs(\?.*)?$/, (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ stats: { total: 1, warn: 0, error: 0 }, capacity: 2000, ...replies[Math.min(call++, replies.length - 1)] }),
    }));
    const lines = await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        await cfg.loadServerLog({ reset: true });
        await cfg.loadServerLog();
        return cfg._logLines.map((l) => l.msg);
    });
    expect(lines).toEqual(['new line']);
});
