// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

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

/** A bookmark the report already has preview metadata for. */
const WITH_PREVIEW = {
    pageId: 1, index: 0, pageName: 'dev', name: 'Never opened one',
    url: 'https://example.com/never-opened', category: 'tools',
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

/** A bookmark with no preview stored, so the card has to ask for one. */
const WITHOUT_PREVIEW = {
    pageId: 1, index: 1, pageName: 'dev', name: 'Bare one',
    url: 'https://example.com/bare', category: 'tools',
    status: 'unused', score: 65, duplicateCount: 0,
    flags: ['unused'],
    openCount: 0, lastOpened: 0,
    reasons: ['Never opened'],
    reasonDetails: [{ code: 'never_opened', penalty: 10 }],
};

function report() {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 2, healthyCount: 0, brokenCount: 0,
            duplicateCount: 0, uncheckedCount: 0, staleCount: 0, unusedCount: 2,
        },
        issues: [WITH_PREVIEW, WITHOUT_PREVIEW],
        duplicateGroups: [],
    };
}

/**
 * Open the health view on a mocked report, with the preview fold reset.
 *
 * The fold is remembered in localStorage across sessions, so a test that did not
 * clear it would pass or fail depending on what the previous one chose.
 */
async function openHealthView(page, { previewBody } = {}) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(report()),
        });
    });
    await page.route('**/api/bookmark-preview**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(previewBody || {
                url: 'https://example.com/bare',
                title: 'A fetched preview title',
                description: 'A description that had to be asked for.',
                image: '',
            }),
        });
    });
    await page.addInitScript(() => {
        try { localStorage.removeItem('nextdashHealthFocusPreviewCollapsed'); } catch { /* ignore */ }
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    // Waits for the view, not for a row: the view opens on the Broken filter and
    // this report has no broken rows, so waiting for a row here would be waiting
    // for something the fixture deliberately does not contain.
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-filter-group',
        { timeout: 15_000 });
    await dismissWhatsNewIfPresent(page);
    await page.locator('.health-view-filter-group > [data-health-filter="all"]').click();
    await expect(page.locator('.health-view-item')).toHaveCount(2);
}

/**
 * Open the card on the first row.
 *
 * Through the toolbar button a user actually presses rather than by calling
 * focus.open(), so the queue, the cursor and the overlay are in the state the
 * real entry point leaves them in.
 */
async function openCard(page) {
    await page.locator('.health-view-focus-btn').click();
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
        await card.locator('[data-focus="open"]').click();

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
            const issue = window.dashboardInstance.health._module.focus.currentIssue();
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
            previewBody: { url: 'https://example.com/bare', title: '', description: '', image: '' },
        });
        await openCard(page);
        await page.locator('.health-focus-card [data-focus="next"]').click();
        await expect(page.locator('.health-focus-title')).toHaveText('Bare one');

        // An empty answer is an answer: the card stops promising one is coming.
        await expect(page.locator('.health-focus-preview-empty')).toBeVisible();
        await expect(page.locator('.health-focus-preview-empty')).not.toContainText('…');
    });

    test('folds the preview away, and remembers that across cards', async ({ page }) => {
        await openHealthView(page);
        await openCard(page);

        const card = page.locator('.health-focus-card');
        await expect(card.locator('.health-focus-preview-body')).toBeVisible();

        await card.locator('[data-focus="preview-toggle"]').click();
        await expect(card.locator('.health-focus-preview')).toHaveClass(/is-collapsed/);
        await expect(card.locator('.health-focus-preview-body')).toHaveCount(0);

        // The fold is the answer to "do I want previews while I work", so it
        // holds for the next card rather than being asked again per bookmark.
        await card.locator('[data-focus="next"]').click();
        await expect(page.locator('.health-focus-title')).toHaveText('Bare one');
        await expect(card.locator('.health-focus-preview')).toHaveClass(/is-collapsed/);

        // And unfolding brings it back, fetching what the fold had skipped.
        await card.locator('[data-focus="preview-toggle"]').click();
        await expect(card.locator('.health-focus-preview-title')).toHaveText('A fetched preview title');
    });
});
