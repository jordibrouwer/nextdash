// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * Focus mode, bulk drift-accept, per-bookmark muting, and the overflow counts.
 *
 * The report is mocked so the rows carry exactly the states these features key
 * off — drift findings, a mute — rather than whatever the seeded bookmarks
 * happen to score. Writes are mocked too: the assertions here are about what
 * the view sends and shows, and the server's own behaviour is covered by the
 * Go tests.
 */

/**
 * A monitored, drifted row.
 *
 * `flags` matters: matchesFilter reads it first and only falls back to `status`
 * for reports cached before flags existed. A fixture without it would be
 * matched by the legacy path, which knows one condition per row — so a drifted
 * bookmark would silently drop out of the drift filter and the test would be
 * describing a report shape the server never sends.
 */
function drifted(index, name, extra = {}) {
    return {
        pageId: 1, index, pageName: 'dev', name,
        url: `https://example.com/${name.toLowerCase().replace(/\s+/g, '-')}`,
        category: 'tools', status: 'healthy', score: 100, duplicateCount: 0,
        flags: ['drift', 'healthy'],
        lastChecked: 1752000000000, reasons: [], reasonDetails: [],
        monitor: true, checkStatus: false, monitorIntervalMinutes: 5,
        watchDrift: true, driftNoticed: 'host',
        driftReason: 'Now redirects to new.example', driftSince: 1752000000000,
        ...extra,
    };
}

function report() {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 5, healthyCount: 2, brokenCount: 1,
            duplicateCount: 0, uncheckedCount: 0, staleCount: 1, unusedCount: 1,
            driftCount: 3,
        },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: 'Broken one',
                url: 'https://example.com/broken', category: 'tools',
                status: 'broken', score: 25, duplicateCount: 0,
                flags: ['broken'],
                lastChecked: 1752000000000,
                reasons: ['HTTP 500', 'Never opened'],
                reasonDetails: [
                    { code: 'last_error', detail: 'HTTP 500', penalty: 60 },
                    { code: 'never_opened', penalty: 10 },
                ],
            },
            drifted(1, 'Drift A'),
            drifted(2, 'Drift B', { driftNoticed: 'title-changed', driftReason: 'Page title changed' }),
            // Muted as well as drifted, so the badge and the accept flow are
            // exercised on the same row without needing a sixth bookmark.
            drifted(3, 'Drift C', { notifyMuted: true }),
            {
                pageId: 1, index: 4, pageName: 'dev', name: 'Stale one',
                url: 'https://example.com/stale', category: 'tools',
                status: 'stale', score: 80, duplicateCount: 0,
                flags: ['stale'],
                openCount: 5, lastOpened: 1,
                reasons: ['Not opened in over 30 days'],
                reasonDetails: [{ code: 'not_opened_30_days', penalty: 10 }],
            },
            {
                pageId: 1, index: 5, pageName: 'dev', name: 'Unused one',
                url: 'https://example.com/unused', category: 'tools',
                status: 'unused', score: 85, duplicateCount: 0,
                flags: ['unused'],
                openCount: 0, lastOpened: 0,
                reasons: ['Never opened'],
                reasonDetails: [{ code: 'never_opened', penalty: 10 }],
            },
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(report()),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });

    // The what's-new modal can reopen after the dashboard settles, which is
    // after prepareDashboardInteraction already cleared it once, and it would
    // swallow the filter click below. The shared helper is what closes it for
    // good: it marks the running release as seen first, so the modal cannot
    // simply come back a second later.
    await dismissWhatsNewIfPresent(page);

    // The view opens on Broken, which hides the monitored rows these tests are
    // about. Switching to All through the real pill rather than by setting
    // this.filter keeps the toolbar, the counts and the row order consistent
    // with what a user would be looking at.
    await page.locator('.health-view-filter-group > [data-health-filter="all"]').click();
    await expect(page.locator('.health-view-item')).toHaveCount(6);
}

/** Tick a row's selection box by its visible name. */
async function selectRow(page, name) {
    await page.locator('.health-view-item', { hasText: name })
        .locator('.health-view-select-box').check();
}

test.describe('health focus mode', () => {
    test('opens from the toolbar and shows one issue at a time', async ({ page }) => {
        await openHealthView(page);

        const total = await page.locator('.health-view-item').count();
        await page.locator('.health-view-focus-btn').click();

        const card = page.locator('.health-focus-card');
        await expect(card).toBeVisible();
        // Starts at the top of the filtered list, and says where it is.
        await expect(page.locator('.health-focus-progress')).toHaveText(`1 of ${total}`);
        await expect(card.locator('.health-focus-title')).toHaveText('Broken one');
        // The reasons come from the same report the row rendered from.
        await expect(card.locator('.health-focus-reasons li').first()).toContainText('HTTP 500');
    });

    test('j and k walk the queue, and Escape leaves on the row it was showing', async ({ page }) => {
        await openHealthView(page);
        await page.locator('.health-view-focus-btn').click();

        // Sorted worst-score-first, so the queue runs Broken, Stale, Unused,
        // then the three healthy-but-drifted rows. Inside focus mode j always
        // advances — unlike the list, there is no "select the first row" step,
        // because the card already is a selection.
        await expect(page.locator('.health-focus-title')).toHaveText('Broken one');
        await page.keyboard.press('j');
        await expect(page.locator('.health-focus-title')).toHaveText('Stale one');
        await page.keyboard.press('j');
        await expect(page.locator('.health-focus-title')).toHaveText('Unused one');
        await page.keyboard.press('k');
        await expect(page.locator('.health-focus-title')).toHaveText('Stale one');
        await expect(page.locator('.health-focus-progress')).toHaveText('2 of 6');

        await page.keyboard.press('Escape');
        await expect(page.locator('.health-focus-overlay')).toHaveCount(0);
        // Lands on the card that was showing, not on where it was entered.
        // 'Stale one' is pageId 1, index 4.
        expect(await page.evaluate(() => window.dashboardInstance.health.selectedKey)).toBe('1:4');
    });

    test('f opens on the row under the keyboard cursor', async ({ page }) => {
        await openHealthView(page);

        // The cursor starts nowhere, so the first j selects the top row and the
        // second moves off it — landing on 'Stale one', the second in score
        // order. Focus mode has to open there rather than at the top.
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        expect(await page.evaluate(() => window.dashboardInstance.health.selectedKey)).toBe('1:4');

        await page.keyboard.press('f');
        await expect(page.locator('.health-focus-card')).toBeVisible();
        await expect(page.locator('.health-focus-title')).toHaveText('Stale one');
    });

    test('stops at the end of the queue rather than wrapping', async ({ page }) => {
        await openHealthView(page);
        const total = await page.locator('.health-view-item').count();
        await page.locator('.health-view-focus-btn').click();

        for (let i = 1; i < total; i += 1) {
            await page.keyboard.press('j');
        }
        await expect(page.locator('.health-focus-progress')).toHaveText(`${total} of ${total}`);

        // One more press must not roll back round to the first row.
        await page.keyboard.press('j');
        await expect(page.locator('.health-focus-progress')).toHaveText(`${total} of ${total}`);
    });

    test('the list behind the overlay does not also act on the keys', async ({ page }) => {
        await openHealthView(page);
        await page.locator('.health-view-focus-btn').click();

        // x is the list's "tick this row" key. While focus mode is open it must
        // not reach the list, or working the queue would silently build a
        // selection behind the overlay.
        await page.keyboard.press('x');
        expect(await page.evaluate(
            () => window.dashboardInstance.health.multiSelect?.selected.size || 0
        )).toBe(0);
    });
});

test.describe('bulk drift accept', () => {
    test('the button appears only when the selection carries drift findings', async ({ page }) => {
        await openHealthView(page);

        // A row with no drift finding: the bar appears, the accept button does not.
        await selectRow(page, 'Stale one');
        await expect(page.locator('.health-bulk-bar')).toBeVisible();
        await expect(page.locator('[data-bulk="accept-drift"]')).toHaveCount(0);

        // Adding a drifted row brings it in, counting only the drifted ones.
        await selectRow(page, 'Drift A');
        await expect(page.locator('[data-bulk="accept-drift"]')).toContainText('1');

        await selectRow(page, 'Drift B');
        await expect(page.locator('[data-bulk="accept-drift"]')).toContainText('2');
    });

    test('sends only the drifted rows, each with the URL the server verifies', async ({ page }) => {
        await openHealthView(page);

        /** @type {any} */
        let sent = null;
        await page.route('**/api/health/accept-drift', async (route) => {
            sent = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ accepted: sent.targets.length, skipped: 0 }),
            });
        });

        // A drifted row and a clean one; only the drifted one may be sent.
        await selectRow(page, 'Drift A');
        await selectRow(page, 'Stale one');
        await page.locator('[data-bulk="accept-drift"]').click();

        // The confirmation is deliberate — accepting discards findings. The
        // confirm button is the first .modal-button in the actions row.
        await page.locator('#app-modal .modal-button').first().click();

        await expect.poll(() => sent).not.toBeNull();
        expect(sent.targets).toHaveLength(1);
        expect(sent.targets[0]).toMatchObject({
            pageId: 1, index: 1, url: 'https://example.com/drift-a',
        });
    });
});

test.describe('per-bookmark alert muting', () => {
    test('a muted row says so, and an unmuted one does not', async ({ page }) => {
        await openHealthView(page);

        const muted = page.locator('.health-view-item', { hasText: 'Drift C' });
        await expect(muted.locator('.health-muted-badge')).toBeVisible();

        const notMuted = page.locator('.health-view-item', { hasText: 'Drift A' });
        await expect(notMuted.locator('.health-muted-badge')).toHaveCount(0);
    });


    // The menu grew a keyword box, status codes, two checkboxes and a Save
    // button over three releases, and ended up 531px of content in a 382px
    // window: five controls including Save sat below a scrollbar. It is a menu
    // again — three modes, an interval, and a way through to the rest.
    test('the check-mode menu fits without a scrollbar', async ({ page }) => {
        await openHealthView(page);

        const row = page.locator('.health-view-item', { hasText: 'Drift C' });
        await row.locator('.health-check-mode').click();
        const menu = row.locator('.health-check-menu');
        await expect(menu).toBeVisible();

        const fits = await menu.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
        expect(fits, 'the check-mode menu scrolls again').toBe(true);

        // The form is not in there any more, only the entry that opens it.
        await expect(menu.locator('[data-expect-save]')).toHaveCount(0);
        await expect(menu.locator('[data-expect-text]')).toHaveCount(0);
        await expect(menu.locator('[data-expect-open]')).toHaveCount(1);
    });

    // Save below the fold was the worst of it: the form could be filled in with
    // no visible way to store it.
    test('every control in the expectations panel is reachable without scrolling', async ({ page }) => {
        await openHealthView(page);

        const row = page.locator('.health-view-item', { hasText: 'Drift C' });
        await row.locator('.health-check-mode').click();
        await row.locator('[data-expect-open]').click();

        const panel = row.locator('.health-view-expect-panel');
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-expect-save]')).toBeVisible();

        const report = await panel.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const offscreen = [];
            el.querySelectorAll('button, input').forEach((c) => {
                const b = c.getBoundingClientRect();
                if (b.bottom > box.bottom + 1 || b.top < box.top - 1) {
                    offscreen.push((c.textContent || c.type || '').trim());
                }
            });
            return { scrollable: el.scrollHeight > el.clientHeight + 1, offscreen };
        });
        expect(report.scrollable, 'the panel scrolls').toBe(false);
        expect(report.offscreen, 'controls sit outside the panel').toEqual([]);
    });

    test('the toggle rides along with the rest of the expectations', async ({ page }) => {
        await openHealthView(page);

        /** @type {any} */
        let sent = null;
        await page.route('**/api/health/expectations', async (route) => {
            sent = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'success', notifyMuted: sent.notifyMuted }),
            });
        });

        // The expectations moved out of the check-mode popover and into the
        // row's own panel: the menu now only picks a mode, and carries an entry
        // that opens the panel.
        const row = page.locator('.health-view-item', { hasText: 'Drift A' });
        await row.locator('.health-check-mode').click();
        const menu = row.locator('.health-check-menu');
        await expect(menu).toBeVisible();
        await menu.locator('[data-expect-open]').click();

        const panel = row.locator('.health-view-expect-panel');
        await expect(panel).toBeVisible();
        await panel.locator('[data-notify-muted]').check();
        await panel.locator('[data-expect-save]').click();

        await expect.poll(() => sent).not.toBeNull();
        expect(sent.notifyMuted).toBe(true);
        // Sent together with the other expectations, not as its own write.
        expect(sent).toMatchObject({ pageId: 1, index: 1, watchDrift: true });
    });
});

test.describe('filter counts', () => {
    /*
     * There is no overflow menu any more. Every filter is a pill again, in one
     * row that scrolls sideways (3ea26f11) — the More menu it used to hide
     * behind was itself the thing being complained about. What survives from
     * the old test is the claim worth keeping: a filter states its count, and
     * states it legibly.
     */
    test('each filter states its count on the pill', async ({ page }) => {
        await openHealthView(page);

        await expect(page.locator('.health-view-filter-more-btn')).toHaveCount(0);

        const stale = page.locator('[data-health-filter="stale"] .health-view-filter-count');
        await expect(stale).toBeVisible();
        await expect(stale).toHaveText(/^\d+$/);

        // The whole row is reachable without a menu: it scrolls rather than
        // hiding what does not fit.
        const scrolls = await page.evaluate(() => {
            const row = document.querySelector('.health-view-filter-group');
            if (!row) return null;
            return getComputedStyle(row).overflowX;
        });
        expect(['auto', 'scroll']).toContain(scrolls);
    });
});
