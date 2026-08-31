// @ts-check
const { test, expect } = require('./fixtures');
const {
    prepareDashboardInteraction,
    dismissWhatsNewIfPresent,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    markWhatsNewSeen,
    waitForFaviconPrefetch,
    WRITE_TOKEN,
} = require('./e2e-helpers');

/**
 * The review session, end to end.
 *
 * Every piece of this is already tested somewhere: the notice appears, the card
 * navigates, the session ends with a count. What none of them do is walk the
 * whole thing in one go, and the seams between the pieces are where the bugs
 * turned out to live — the card that went on saying "never opened" was, in
 * isolation, three passing tests sitting either side of a break.
 *
 * So the first test here is deliberately one long journey rather than five
 * short ones. The value is in the order: what a card shows *after* the previous
 * card was acted on, whether a count survives a delete, whether the queue is
 * still coherent at the end. A shorter test cannot ask those questions.
 *
 * The other two cover the things a mocked report cannot answer:
 *
 *   - Whether an open actually reaches the server. Every existing test asserts
 *     the in-memory issue and the label, which is exactly what a bug that
 *     writes nowhere would also satisfy. This one reloads and looks again.
 *   - Whether leaving mid-session leaves the list somewhere sensible, without
 *     the abandoned session being counted as finished.
 */

const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/** A row the session is allowed to pick up, worst-first by score. */
function issue(index, name, extra = {}) {
    return {
        pageId: 1, index, pageName: 'dev', name,
        url: `https://example.com/${name.toLowerCase().replace(/\s+/g, '-')}`,
        category: 'tools', duplicateCount: 0,
        status: 'unused', flags: ['unused'], score: 60 + index,
        openCount: 0, lastOpened: 0,
        reasons: ['Never opened'],
        reasonDetails: [{ code: 'never_opened', penalty: 10 }],
        ...extra,
    };
}

/**
 * Five reviewable rows — one over the notice's own minimum.
 *
 * The notice stays quiet below five on purpose ("four stale links are not a
 * session"), so a fixture of four would test the silence rather than the
 * journey.
 */
function report() {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 5, healthyCount: 0, brokenCount: 1,
            duplicateCount: 0, uncheckedCount: 0, staleCount: 0, unusedCount: 4,
        },
        issues: [
            // Worst score first, which is the order a session queues them in.
            issue(0, 'Broken one', {
                status: 'broken', flags: ['broken'], score: 20,
                icon: 'example-com.png',
                previewTitle: 'The stored title',
                previewDesc: 'A description the report already carried.',
                lastError: 'HTTP 500',
                reasons: ['HTTP 500', 'Never opened'],
                reasonDetails: [
                    { code: 'last_error', detail: 'HTTP 500', penalty: 60 },
                    { code: 'never_opened', penalty: 10 },
                ],
            }),
            issue(1, 'Second one'),
            issue(2, 'Third one'),
            issue(3, 'Fourth one'),
            issue(4, 'Fifth one'),
        ],
        duplicateGroups: [],
    };
}

/**
 * Load the dashboard with the report mocked and the popup blocked.
 *
 * window.open is stubbed before load rather than after: a real popup never
 * appears in the harness, so an unstubbed Open click waits for a tab that is
 * not coming.
 */
async function loadDashboard(page, { issues = null } = {}) {
    await page.addInitScript(() => {
        window.__opened = [];
        window.open = (url) => { window.__opened.push(url); return null; };
        try {
            // Both are answers this suite gives itself: yesterday's "not today"
            // would hide the notice, and a remembered fold would hide the
            // preview the first test asserts.
            localStorage.removeItem('nextdashHealthReviewDoneOn');
            localStorage.removeItem('nextdashHealthFocusPreviewCollapsed');
        } catch { /* storage disabled is not this test's subject */ }
    });
    const body = issues ? { ...report(), issues } : report();
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
    }));
    await page.route('**/api/track-open', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: '{"status":"ok"}',
    }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
}

/** The card currently on screen. */
const card = (page) => page.locator('.health-focus-card');

test.describe('a review session, from the offer to the end', () => {
    test('walks the whole thing: notice, card, actions, and a count that means something', async ({ page }) => {
        // Every preview request is counted, because a prefetch that never fires
        // and a prefetch that fires twice both look like a working card.
        const previewedUrls = [];
        await page.route('**/api/bookmark-preview**', (route) => {
            previewedUrls.push(new URL(route.request().url()).searchParams.get('url'));
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ title: 'A fetched title', description: 'Fetched description.', image: '' }),
            });
        });
        await loadDashboard(page);

        // ── The offer ───────────────────────────────────────────────────────
        expect(await page.evaluate(() => window.HealthReviewSession.render())).toBe(true);
        const notice = page.locator('.health-review-notice-card');
        await expect(notice).toBeVisible();
        // It counts by condition rather than as one lump: "1 broken" is a reason
        // to start, "5 issues" is not.
        await expect(notice.locator('.health-review-notice-text')).toContainText(/\d/);

        await notice.locator('[data-health-review-action="start"]').click();
        await expect(card(page)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() =>
            Boolean(window.dashboardInstance.health._module.focus.session))).toBe(true);

        // ── The first card, worst first ─────────────────────────────────────
        await expect(card(page).locator('.health-focus-title')).toHaveText('Broken one');
        await expect(card(page).locator('.health-focus-icon-img'))
            .toHaveAttribute('src', '/data/icons/example-com.png');
        // The report carried this one's preview, so it draws with no request.
        await expect(card(page).locator('.health-focus-preview-title')).toHaveText('The stored title');
        expect(previewedUrls).not.toContain('https://example.com/broken-one');

        // ── Open it, and watch the card change its mind ─────────────────────
        await expect(card(page).locator('.health-focus-opened')).toHaveClass(/is-never/);
        await card(page).locator('[data-focus="open"]').click();

        await expect(card(page).locator('.health-focus-opened')).not.toHaveClass(/is-never/);
        await expect(card(page).locator('.health-focus-reasons li.is-resolved')).toContainText('Never opened');
        // The link really was opened, and the failure it also has is untouched:
        // opening answers "never opened" and says nothing about the 500.
        expect(await page.evaluate(() => window.__opened.length)).toBe(1);
        await expect(card(page).locator('.health-focus-reasons li').first()).not.toHaveClass(/is-resolved/);

        // ── The next card is warmed while this one is still being decided ───
        //
        // Asserted before stepping, which is the whole claim: after the step the
        // card fetches its own preview anyway, so a check made afterwards would
        // pass just as well with no prefetch at all — only later.
        await expect.poll(() => previewedUrls, {
            message: 'the next card in the queue should be fetched before it is reached',
        }).toContain('https://example.com/second-one');

        await card(page).locator('[data-focus="next"]').click();
        await expect(card(page).locator('.health-focus-title')).toHaveText('Second one');
        // Already in hand, so it draws with no skeleton and no second request.
        await expect(card(page).locator('.health-focus-preview-title')).toHaveText('A fetched title');
        expect(previewedUrls.filter((u) => u === 'https://example.com/second-one')).toHaveLength(1);

        // ── Delete one, and have it counted ─────────────────────────────────
        //
        // The confirm is a real in-app modal; stubbing the method is what the
        // other delete specs do, and the modal itself is their subject, not
        // this test's.
        await page.evaluate(() => {
            window.dashboardInstance.health._module.confirm = async () => true;
        });
        // The row has to actually leave the report, or the session has nothing
        // to count: handled is incremented when a row stops being an issue.
        await page.unroute('**/api/bookmark-health**');
        const remaining = report().issues.filter((i) => i.name !== 'Second one');
        await page.route('**/api/bookmark-health**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ...report(), issues: remaining }),
        }));
        await page.route('**/api/health/delete-bookmark', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: '{"success":true}',
        }));
        const queueBefore = await page.evaluate(() =>
            window.dashboardInstance.health._module.focus.queue.length);

        await card(page).locator('[data-focus="delete"]').click();
        // Skipping is not handling; a delete is. This is the number the end of
        // the session reports, and the reason the whole thing is bounded.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.health._module.focus.session.handled)).toBe(1);

        // ── To the end, and the count ───────────────────────────────────────
        // The deleted row left the queue, so what is left is one shorter than
        // it started; pressing past the last one is what ends a session.
        for (let i = 0; i < queueBefore; i += 1) {
            await page.keyboard.press('j');
            await page.waitForTimeout(150);
        }
        const done = page.locator('.health-focus-card--done');
        await expect(done).toBeVisible({ timeout: 10_000 });
        // "You dealt with 1 of 5" — the one that was deleted, and only that one.
        // A session that reported 0 here would be a session nobody would trust
        // to be worth finishing.
        await expect(page.locator('.health-focus-done-count')).toContainText('1');
        await expect(page.locator('.health-focus-done-count')).toContainText(String(queueBefore));

        // ── Another ten starts a fresh session rather than resuming this one ─
        const again = done.locator('[data-focus="again"]');
        if (await again.count()) {
            await again.click();
            await expect(card(page)).toBeVisible();
            const session = await page.evaluate(() =>
                window.dashboardInstance.health._module.focus.session);
            expect(session.handled).toBe(0);
            expect(await page.evaluate(() =>
                window.dashboardInstance.health._module.focus.position)).toBe(0);
        }
    });

    /**
     * Escape mid-session leaves, and does not quietly count as finishing.
     *
     * "Done for today" is a decision someone makes; walking away is not, and an
     * abandoned session that suppressed tomorrow's offer would be the app
     * answering a question on the reader's behalf.
     */
    test('leaving halfway lands on the row you were on, and answers nothing', async ({ page }) => {
        await loadDashboard(page);
        await page.route('**/api/bookmark-preview**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ title: '', description: '', image: '' }),
        }));

        // Open the view and widen it through the pill a reader would click,
        // before starting the session.
        //
        // A session queues from every issue, while the list behind it is still
        // on whatever filter was chosen — and syncKeyboardSelectionAfterRender
        // drops a cursor that is not among the visible rows. So on the default
        // Broken filter the landing is discarded by design, and asserting it
        // there would be asserting the filter rather than the leaving.
        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout .health-view-filter-group',
            { timeout: 15_000 });
        await dismissWhatsNewIfPresent(page);
        await page.locator('.health-view-filter-group > [data-health-filter="all"]').click();
        await expect(page.locator('.health-view-item')).toHaveCount(5);

        await page.evaluate(() => window.HealthReviewSession.start());
        await expect(card(page)).toBeVisible({ timeout: 15_000 });

        await page.keyboard.press('j');
        await expect(card(page).locator('.health-focus-title')).toHaveText('Second one');
        const landingKey = await page.evaluate(() => {
            const focus = window.dashboardInstance.health._module.focus;
            return focus.queue[focus.position];
        });
        await page.keyboard.press('Escape');
        await expect(page.locator('.health-focus-overlay')).toHaveCount(0);

        // The cursor is left on the card that was showing, not on the row the
        // session started from: someone two rows deep means to continue there.
        expect(await page.evaluate(() =>
            window.dashboardInstance.health._module.selectedKey)).toBe(landingKey);
        await expect(page.locator('.health-view-item[aria-selected="true"]')).toHaveCount(1);
        await expect(page.locator('.health-view-item[aria-selected="true"]'))
            .toContainText('Second one');

        // And tomorrow's offer is still owed an answer: walking away is not the
        // same as saying "done for today", which is a decision someone makes.
        expect(await page.evaluate(() => window.HealthReviewSession.isDoneToday())).toBe(false);
    });
});

/**
 * The half a mocked report cannot test: whether the open is actually stored.
 *
 * Nothing is mocked here — not the report, not /api/track-open — because the
 * question is precisely whether the write reaches the server and comes back on
 * the next read. A test that mocks either one would pass against a client that
 * writes nowhere, which is the bug being guarded against.
 */
test.describe('an open, after a reload', () => {
    test('survives: the row no longer says never opened', async ({ page, request }) => {
        await page.addInitScript(() => {
            window.__opened = [];
            window.open = (url) => { window.__opened.push(url); return null; };
        });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        // The favicon prefetch reloads every row ~400ms after setup, well after
        // the dashboard looks settled. Seeding before that lands is how a spec
        // loses its own write and then reads a row it never seeded.
        await waitForFaviconPrefetch(page);

        // A bookmark that has genuinely never been opened, written through the
        // API so the store is the one answering, not a fixture.
        const existing = await (await request.get('/api/bookmarks?page=1')).json();
        test.skip(!Array.isArray(existing) || !existing.length, 'needs a seeded bookmark');
        const bookmarks = existing.map((bm, i) => (i === 0
            ? { ...bm, openCount: 0, lastOpened: 0 }
            : bm));
        const seeded = await request.post('/api/bookmarks?page=1', {
            headers: writeHeaders, data: bookmarks,
        });
        expect(seeded.ok()).toBeTruthy();

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
        await dismissBlockingOverlays(page);
        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout .health-view-filter-group', { timeout: 20_000 });
        await dismissWhatsNewIfPresent(page);
        await page.locator('.health-view-filter-group > [data-health-filter="all"]').click();
        await page.waitForSelector('.health-view-item', { timeout: 20_000 });

        // Open the seeded row through the card, which is the path this whole
        // feature is about.
        const target = page.locator('.health-view-item').filter({ hasText: bookmarks[0].name }).first();
        test.skip(!(await target.count()), 'the seeded bookmark is not a health issue on this install');
        await target.click();
        await page.locator('.health-view-focus-btn').click();
        await expect(card(page)).toBeVisible({ timeout: 15_000 });
        await expect(card(page).locator('.health-focus-title')).toContainText(bookmarks[0].name);
        await card(page).locator('[data-focus="open"]').click();
        await expect(card(page).locator('.health-focus-opened')).not.toHaveClass(/is-never/);

        // The real assertion: ask the server, not the page.
        await expect.poll(async () => {
            const rows = await (await request.get('/api/bookmarks?page=1')).json();
            return Number(rows[0]?.openCount) || 0;
        }, { timeout: 10_000 }).toBeGreaterThan(0);
    });
});
