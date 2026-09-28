// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * What the review card knows about the bookmark it is asking you to judge.
 *
 * The card used to show a name, a URL and a list of reasons — which is enough to
 * decide about a dead link and not nearly enough to decide about a link you do
 * not recognise. Three things changed, and each one is pinned here because each
 * one was a way the card misled:
 *
 *   - Opening a bookmark updates the card. The open was always recorded; only
 *     the list row behind the overlay was repainted, so the card went on saying
 *     "never opened" about a link you had just opened.
 *   - The page's own preview is shown, and fetched when the report has none.
 *   - The favicon is drawn, resolved the same way the list row resolves it.
 *
 * The report is mocked so the rows carry exactly the states these features key
 * off, rather than whatever the seeded bookmarks happen to score.
 */

/** What the report says of the first bookmark: preview metadata already in hand. */
const WITH_PREVIEW = {
    name: 'Never opened one',
    status: 'unused', score: 60, duplicateCount: 0,
    flags: ['unused'],
    openCount: 0, lastOpened: 0,
    icon: 'example-com.png',
    previewTitle: 'A stored preview title',
    previewDesc: 'A description the report already carried.',
    previewImage: 'https://example.com/card.png',
    reasons: ['Never opened'],
    reasonDetails: [{ code: 'never_opened', penalty: 10 }],
};

/** The second: no preview stored, so the card has to ask for one. */
const WITHOUT_PREVIEW = {
    name: 'Bare one',
    status: 'unused', score: 65, duplicateCount: 0,
    flags: ['unused'],
    openCount: 0, lastOpened: 0,
    previewTitle: '', previewDesc: '', previewImage: '',
    reasons: ['Never opened'],
    reasonDetails: [{ code: 'never_opened', penalty: 10 }],
};

/** The second again, scored down for having no preview stored. */
const MISSING_PREVIEW = {
    ...WITHOUT_PREVIEW,
    status: 'content', flags: ['content'],
    reasons: ['No preview metadata yet'],
    reasonDetails: [{ code: 'no_preview', penalty: 5 }],
};

/**
 * The Bookmarks view over a report that knows only the first two bookmarks,
 * as the two above.
 */
async function openHealthView(page, { previewBody, noPreviewReason = false } = {}) {
    await page.route('**/api/bookmark-preview**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(previewBody || {
                title: 'A fetched preview title',
                description: 'A description that had to be asked for.',
                image: '',
            }),
        });
    });
    return openBookmarksWithHealth(page, (issues) => [
        { ...issues[0], ...WITH_PREVIEW },
        { ...issues[1], ...(noPreviewReason ? MISSING_PREVIEW : WITHOUT_PREVIEW) },
    ]);
}

/**
 * Open the card on the first row, through the button a user presses (Work
 * through) rather than by calling focus.open(), so the queue, the cursor and
 * the overlay are in the state the real entry point leaves them in.
 */
async function openCard(page) {
    await page.locator('[data-bm-work-through]').click();
    await page.locator('[data-focus-pile="list"]').click();
    await expect(page.locator('.health-focus-card')).toBeVisible();
}

test.describe('the review card', () => {
    test('says the bookmark was opened, instead of still calling it never opened', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        const card = page.locator('.health-focus-card');
        await expect(card.locator('.health-focus-title')).toHaveText('Never opened one');
        // The starting state is the finding itself: this is what the session is
        // asking about.
        await expect(card.locator('.health-focus-opened')).toHaveClass(/is-never/);

        // window.open would put a real tab in front of the test; the click is
        // what is being tested, not the browser's tab handling.
        await page.evaluate(() => { window.open = () => null; });
        await card.locator('.health-focus-open').click();

        // The card now agrees with what was recorded, without leaving it.
        const opened = card.locator('.health-focus-opened');
        await expect(opened).not.toHaveClass(/is-never/);
        await expect(opened).not.toHaveText(/never/i);

        // And the reason it was in the queue for is struck through rather than
        // removed — the score and the list behind still count it until the next
        // report, so deleting the line would make the card disagree with both.
        await expect(card.locator('.health-focus-reasons li.is-resolved')).toHaveCount(1);
        await expect(card.locator('.health-focus-reasons li.is-resolved')).toContainText('Never opened');

        // The open really was persisted, not merely painted.
        const state = await page.evaluate(() => {
            const issue = window.dashboardInstance.config.instance._libFocus.currentIssue();
            return { openCount: issue.openCount, lastOpened: issue.lastOpened };
        });
        expect(state.openCount).toBe(1);
        expect(state.lastOpened).toBeGreaterThan(0);
    });

    test('draws the favicon the report carried', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        // Prefixed with /data/icons/ exactly as the list row does: a bare
        // filename would resolve against the current path and 404.
        await expect(page.locator('.health-focus-icon-img')).toHaveAttribute(
            'src', '/data/icons/example-com.png');
    });

    test('shows the preview the report carried, without asking the server', async ({ page }) => {
        let asked = 0;
        await page.route('**/api/bookmark-preview**', async (route) => {
            asked += 1;
            await route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ title: 'should not be used', description: '', image: '' }),
            });
        });
        await openHealthView(page);
        await openCard(page);

        const card = page.locator('.health-focus-card');
        await expect(card.locator('.health-focus-preview-title')).toHaveText('A stored preview title');
        await expect(card.locator('.health-focus-preview-desc'))
            .toHaveText('A description the report already carried.');
        // The first card had its preview in hand. Any request that happened is
        // the prefetch for the second card, never a fetch for this one.
        expect(asked).toBeLessThanOrEqual(1);
    });

    test('fetches the preview when the report has none', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        // Step to the row with no stored preview.
        await page.locator('.health-focus-card [data-focus="next"]').click();
        await expect(page.locator('.health-focus-title')).toHaveText('Bare one');

        const card = page.locator('.health-focus-card');
        await expect(card.locator('.health-focus-preview-title')).toHaveText('A fetched preview title');
        await expect(card.locator('.health-focus-preview-desc'))
            .toHaveText('A description that had to be asked for.');
    });

    test('says so plainly when the page offers no preview at all', async ({ page }) => {
        await openHealthView(page, {
            previewBody: { title: '', description: '', image: '' },
        });
        await openCard(page);
        await page.locator('.health-focus-card [data-focus="next"]').click();
        await expect(page.locator('.health-focus-title')).toHaveText('Bare one');

        // An empty answer is an answer: the card stops promising one is coming.
        await expect(page.locator('.health-focus-preview-empty')).toBeVisible();
        await expect(page.locator('.health-focus-preview-empty')).not.toContainText('…');
    });
});

/**
 * "Not this one, not now" — the answer the session was missing.
 *
 * A link can be broken on purpose: a service that is off for the winter, a host
 * that only answers from another network. Skip brings it back tomorrow and
 * Delete is not what you meant, so the session had no way to say the true
 * thing. Ignoring for thirty days is that answer, and it is deliberately the
 * same write the row menu's z makes rather than a second mechanism: a link
 * silenced here is silenced everywhere, and comes back on the same day.
 */
test.describe('putting one aside for a month', () => {
    test('the card offers it, keyed the same as the row menu', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        const snooze = page.locator('.health-focus-card [data-focus="snooze"]');
        await expect(snooze).toBeVisible();
        // The figure comes from the one constant, so the label cannot drift
        // from what the write actually does.
        const days = await page.evaluate(() => {
            const health = window.dashboardInstance.health._module || window.dashboardInstance.health;
            return health.constructor.SNOOZE_DAYS;
        });
        await expect(snooze).toContainText(String(days));
        await expect(snooze.locator('kbd')).toHaveText('z');
    });

    test('it writes the ignore and takes the row out of the session', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        const asked = [];
        await page.route('**/api/health/ignore**', async (route) => {
            asked.push(route.request().postData() || '');
            await route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
            });
        });

        const before = await page.evaluate(() => {
            return window.dashboardInstance.config.instance._libFocus.queue.length;
        });

        await page.locator('.health-focus-card [data-focus="snooze"]').click();
        await page.waitForTimeout(1200);

        // The write went out, carrying an expiry rather than a permanent mute.
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.join(' ')).toContain('until');

        // And the session moved on: a card that keeps showing what you have
        // just dealt with is not counting honestly.
        const after = await page.evaluate(() => {
            return window.dashboardInstance.config.instance._libFocus.queue.length;
        });
        expect(after).toBeLessThan(before);
    });

    /*
     * A row with nothing to silence is not offered the button. The whole
     * gesture needs a condition to act on, and an always-present control that
     * usually refuses is the thing this codebase keeps deciding against.
     */
    test('a row with no condition to hide is not offered it', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        const offered = await page.evaluate(() => {
            const focus = window.dashboardInstance.config.instance._libFocus;
            // The queue holds keys; currentIssue resolves one against the live
            // report, which is what run() hands every action.
            const issue = focus.currentIssue();
            return {
                // The card's own answer, which reads this row's status rather
                // than the list's filter -- the session runs across filters.
                hasFlag: Boolean(focus.snoozeFlagFor(issue)),
                button: Boolean(document.querySelector('.health-focus-card [data-focus="snooze"]')),
            };
        });
        // Whatever this fixture's first row is, the two answers agree.
        expect(offered.button).toBe(offered.hasFlag);
    });

    test('a fetched preview can be saved onto the bookmark, and the reason goes', async ({ page }) => {
        const { issues } = await openHealthView(page, { noPreviewReason: true });
        await openCard(page);
        await page.locator('.health-focus-card [data-focus="next"]').click();
        const card = page.locator('.health-focus-card');
        await expect(card.locator('.health-focus-title')).toHaveText('Bare one');
        await expect(card.locator('.health-focus-preview-title')).toHaveText('A fetched preview title');
        // The card has a preview; the bookmark does not, and the reason says so.
        await expect(card.locator('.health-focus-reasons')).toContainText('Preview fetched, not saved yet');
        await expect(card.locator('[data-focus="save-preview"]')).toBeVisible();

        const patches = [];
        await page.route('**/api/bookmarks', (route) => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            patches.push(JSON.parse(route.request().postData() || '{}'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: 1 }) });
        });
        // The report as the server builds it once the preview is stored.
        const saved = { ...issues[1], previewTitle: 'A fetched preview title', previewDesc: 'A description that had to be asked for.', reasons: [], reasonDetails: [], status: 'healthy', flags: ['healthy'] };
        await page.route('**/api/bookmark-health**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ generatedAt: Date.now(), summary: { totalBookmarks: 2, brokenCount: 0 }, issues: [issues[0], saved] }),
        }));

        await page.keyboard.press('s');
        await expect.poll(() => patches.length).toBe(1);
        expect(patches[0].page).toBe(Number(issues[1].pageId));
        expect(patches[0].updates).toEqual([{
            url: issues[1].url,
            previewTitle: 'A fetched preview title',
            previewDesc: 'A description that had to be asked for.',
            previewImage: '',
        }]);
        await expect(card.locator('[data-focus="save-preview"]')).toHaveCount(0);
        await expect(card.locator('.health-focus-reasons')).toHaveCount(0);
        // The list behind the card has the new report too.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._bmHealthModule.report.issues[1].reasons.length)).toBe(0);
    });

    /*
     * A page can still hold the same link twice from before duplicates were
     * refused. The PATCH names rows by URL, so without the occurrence the
     * preview landed on the first copy, the server said "updated", and the card
     * went on offering to save onto the second. Seeded in the browser, the way
     * the duplicates spec does it: the server refuses to create such a pair.
     */
    test('saving the preview of the second copy of a URL names that copy', async ({ page }) => {
        await page.route('**/api/bookmark-preview**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ title: 'A fetched preview title', description: '', image: '' }),
        }));
        const { issues } = await openBookmarksWithHealth(page, (rows) => {
            // The original is now row 2; its page-local index is what the
            // server's report would carry.
            const second = rows[2];
            const pageIndex = rows.slice(0, 2).filter((b) => b.pageId === second.pageId).length;
            return [
                { ...rows[0], ...WITH_PREVIEW },
                { ...second, index: pageIndex, ...MISSING_PREVIEW },
            ];
        }, {
            prepare: () => {
                const d = window.dashboardInstance;
                const copy = { ...d.allBookmarks[1], name: 'First copy' };
                d.allBookmarks = [d.allBookmarks[0], copy, ...d.allBookmarks.slice(1)];
            },
        });
        await openCard(page);
        await page.locator('.health-focus-card [data-focus="next"]').click();
        const card = page.locator('.health-focus-card');
        await expect(card.locator('.health-focus-title')).toHaveText('Bare one');
        await expect(card.locator('[data-focus="save-preview"]')).toBeVisible();

        const patches = [];
        await page.route('**/api/bookmarks', (route) => {
            if (route.request().method() !== 'PATCH') return route.fallback();
            patches.push(JSON.parse(route.request().postData() || '{}'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: 1 }) });
        });
        await page.keyboard.press('s');
        await expect.poll(() => patches.length).toBe(1);
        expect(patches[0].updates).toHaveLength(1);
        expect(patches[0].updates[0].url).toBe(issues[1].url);
        expect(patches[0].updates[0].occurrence).toBe(1);
    });

    test('with the preview already stored there is nothing to save, and s does nothing', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);
        await expect(page.locator('.health-focus-preview-title')).toHaveText('A stored preview title');
        await expect(page.locator('[data-focus="save-preview"]')).toHaveCount(0);
    });
});
