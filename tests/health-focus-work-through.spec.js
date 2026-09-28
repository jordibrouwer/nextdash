// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Work through, as the Bookmarks view opens it.
 *
 * The walk used to drop the reader straight onto a card with a bookmark on it
 * and a row of equal buttons, and nobody could tell what it was for. It now
 * asks which pile first, says on every card why the bookmark is there, and
 * offers one next step that fits that reason; the rest sit below it.
 *
 * The report is mocked: one broken link, one stale, one never opened whose
 * stored preview title carries an HTML entity.
 */

async function openLibrary(page) {
    await openBookmarksWithHealth(page, (issues) => issues.map((issue, i) => {
        if (i === 0) return issue;
        if (i === 1) {
            return { ...issue, status: 'stale', flags: ['stale'], score: 80, openCount: 3, lastOpened: 1,
                reasons: ['Not opened in over 30 days'], reasonDetails: [{ code: 'not_opened_30_days', penalty: 10 }] };
        }
        if (i === 2) {
            return { ...issue, name: '', status: 'unused', flags: ['unused'], score: 85, openCount: 0, lastOpened: 0,
                previewTitle: 'I&#039;m a stored title', previewDesc: 'Fish &amp; chips',
                reasons: ['Never opened'], reasonDetails: [{ code: 'never_opened', penalty: 10 }] };
        }
        return issue;
    }));
}

const card = (page) => page.locator('.health-focus-card');
const chooser = (page) => page.locator('[data-focus-chooser]');

async function startPile(page, id) {
    await page.locator('[data-bm-work-through]').click();
    await expect(chooser(page)).toBeVisible();
    await page.locator(`[data-focus-pile="${id}"]`).click();
    await expect(card(page).locator('.health-focus-why')).toBeVisible();
}

test.describe('the way in', () => {
    test('asks which pile first, each with its count, the worst first', async ({ page }) => {
        await openLibrary(page);
        await page.locator('[data-bm-work-through]').click();
        await expect(chooser(page)).toBeVisible();
        const piles = chooser(page).locator('[data-focus-pile]');
        expect(await piles.evaluateAll((els) => els.map((el) => el.getAttribute('data-focus-pile'))))
            .toEqual(['broken', 'stale', 'unused', 'list']);
        await expect(piles.nth(0).locator('.health-focus-pile-count')).toHaveText('1');
        await expect(piles.nth(0)).toHaveAttribute('aria-selected', 'true');
        // Nothing is walked until a pile is chosen.
        await expect(card(page).locator('.health-focus-why')).toHaveCount(0);
    });

    test('the arrows choose and Enter starts that pile', async ({ page }) => {
        await openLibrary(page);
        await page.locator('[data-bm-work-through]').click();
        await expect(chooser(page)).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-focus-pile="stale"]')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Enter');
        await expect(page.locator('.health-focus-progress')).toHaveText(/^Stale · 1 of 1$/);
    });

    test('Escape leaves without a walk', async ({ page }) => {
        await openLibrary(page);
        await page.locator('[data-bm-work-through]').click();
        await expect(chooser(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.health-focus-overlay')).toHaveCount(0);
    });
});

test.describe('the card', () => {
    test('says why the bookmark is here', async ({ page }) => {
        await openLibrary(page);
        await startPile(page, 'broken');
        await expect(card(page).locator('.health-focus-why-title')).toHaveText('Why it is here: It does not answer');
        await expect(card(page).locator('.health-focus-reasons')).toContainText('HTTP 500');
    });

    test('a broken link is offered a re-check first', async ({ page }) => {
        await openLibrary(page);
        await startPile(page, 'broken');
        await expect(card(page).locator('.health-focus-primary')).toHaveAttribute('data-focus', 'recheck');
        // Not offered twice.
        await expect(card(page).locator('[data-focus="recheck"]')).toHaveCount(1);
    });

    test('a stale one is offered a look first', async ({ page }) => {
        await openLibrary(page);
        await startPile(page, 'stale');
        await expect(card(page).locator('.health-focus-primary')).toHaveAttribute('data-focus', 'open');
        await expect(card(page).locator('.health-focus-alts [data-focus="recheck"]')).toBeVisible();
    });

    test('o opens the bookmark, and the card says so', async ({ page }) => {
        await openLibrary(page);
        const opened = [];
        await page.exposeFunction('__recordOpen', (url) => { opened.push(url); });
        await page.evaluate(() => { window.open = (url) => { window.__recordOpen(String(url)); return null; }; });
        await startPile(page, 'unused');
        await expect(card(page).locator('.health-focus-opened')).toHaveClass(/is-never/);
        await page.keyboard.press('o');
        await expect.poll(() => opened.length).toBe(1);
        await expect(card(page).locator('.health-focus-opened')).not.toHaveClass(/is-never/);
    });

    test('a stored preview title shows its entities as characters', async ({ page }) => {
        await openLibrary(page);
        await startPile(page, 'unused');
        await expect(card(page).locator('.health-focus-title')).toHaveText('I\'m a stored title');
        await expect(card(page).locator('.health-focus-preview-desc')).toHaveText('Fish & chips');
    });

    test('e opens the bookmark form on this bookmark, and the card waits', async ({ page }) => {
        await openLibrary(page);
        await startPile(page, 'broken');
        const url = await page.evaluate(() => window.dashboardInstance.config.instance._libFocus.currentIssue().url);
        await page.keyboard.press('e');
        const form = page.locator('#bookmark-form-modal');
        await expect(form).toHaveClass(/show/);
        await expect(form.locator('input[type="url"], input[name="url"]').first()).toHaveValue(url);
        // The card's keys stand still under the form: j does not move the walk.
        const before = await page.locator('.health-focus-progress').textContent();
        await page.keyboard.press('j');
        await expect(page.locator('.health-focus-progress')).toHaveText(before || '');
    });
});

test.describe('keeping one', () => {
    test('y keeps it for good, and the pile ends with the tally', async ({ page }) => {
        await openLibrary(page);
        const asked = [];
        await page.route('**/api/health/ignore**', async (route) => {
            asked.push(route.request().postDataJSON?.() || route.request().postData());
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await startPile(page, 'stale');
        await page.keyboard.press('y');

        await expect(page.locator('.health-focus-card--done')).toBeVisible();
        expect(asked.length).toBeGreaterThan(0);
        // No expiry: kept is not snoozed.
        expect(JSON.stringify(asked)).not.toMatch(/"until(Ms)?":\s*[1-9]/);

        const stats = page.locator('.health-focus-stat');
        await expect(stats.nth(2)).toContainText('1');
        await expect(stats.nth(2)).toContainText('kept');
        await expect(page.locator('.health-focus-done-rest')).toContainText('Broken links');
    });

    test('the summary starts the next pile', async ({ page }) => {
        await openLibrary(page);
        await page.route('**/api/health/ignore**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
        }));
        await startPile(page, 'stale');
        await page.keyboard.press('y');
        await page.locator('[data-focus="next-pile"]').click();
        await expect(page.locator('.health-focus-progress')).toHaveText(/^Broken links · 1 of 1$/);
    });
});
