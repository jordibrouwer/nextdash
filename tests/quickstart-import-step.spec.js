// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The last step of the setup card: where your own bookmarks come in.
 *
 * Whoever has just chosen to start from scratch is looking at an empty
 * dashboard and wondering whether they have to type it all in. The card ended
 * one step earlier, so nothing ever told them the answer.
 */
async function openSetupCard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    /*
     * The card is a first-run thing, so both flags have to be off before the
     * quick-start decides whether to draw it. Both, because the store is reset
     * per spec file rather than per test: the test before this one finished
     * the card, and a run that inherits that never sees it again.
     */
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        const current = await (await f('/api/settings')).json();
        await f('/api/settings', {
            method: 'POST', headers,
            body: JSON.stringify({
                ...current,
                onboardingCompleted: false,
                autoDarkMode: false,
                quickStart: { setupDone: false, dismissed: false, visitedConfig: false, seenCheatsheet: false },
            }),
        });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.quickstart-setup')).toBeVisible({ timeout: 15_000 });
}

/** Walk to the last step by pressing Next as a reader would. */
async function toLastStep(page) {
    const progress = () => page.locator('.quickstart-progress').innerText();
    for (let guard = 0; guard < 8; guard += 1) {
        const text = await progress();
        if (/5\D+5|5\s*\/\s*5/.test(text) || (await page.locator('[data-qs-goto]').count())) break;
        await page.locator('[data-qs-action="next-setup"]').click();
        await page.waitForTimeout(150);
    }
}

test.describe('the setup card points at importing', () => {
    test('there is a fifth step, and it offers both ways in', async ({ page }) => {
        await openSetupCard(page);
        // Four steps before, five now — said on the card itself, so a reader
        // knows how much is left.
        await expect(page.locator('.quickstart-progress')).toContainText(/1.*5/);

        await toLastStep(page);
        await expect(page.locator('.quickstart-progress')).toContainText(/5.*5/);
        await expect(page.locator('[data-qs-goto="backups"]')).toBeVisible();
        await expect(page.locator('[data-qs-goto="sources"]')).toBeVisible();
        // Last step, so the button that leaves the card says so.
        await expect(page.locator('[data-qs-action="next-setup"]'))
            .toHaveText(/Finish|Klaar|Fertig|Terminer/);
    });

    test('the import link lands on the screen that does it', async ({ page }) => {
        await openSetupCard(page);
        await toLastStep(page);
        await page.locator('[data-qs-goto="backups"]').click();

        // Not "the section was set" but "the buttons are on screen": the whole
        // point of the step is getting someone to the thing itself, and import
        // sits inside a fold that is closed by default.
        await expect(page.locator('[data-backup-action="browser-import"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-backup-action="csv-import"]')).toBeVisible();
        // Restoring a whole backup is on the same screen but in a fold of its
        // own, which the link does not promise to open — present, not shown.
        await expect(page.locator('[data-backup-action="import"]')).toHaveCount(1);
    });

    test('following a link still finishes the setup rather than dropping it', async ({ page }) => {
        await openSetupCard(page);
        // Change something on the first step, so there is an answer to lose.
        await page.locator('input[name="qs-autodark"][value="true"]').check();
        await toLastStep(page);
        await page.locator('[data-qs-goto="sources"]').click();

        await expect(page.locator('[data-db-tab="sources"]')).toBeVisible({ timeout: 15_000 });
        // The card is gone and its answers were written, not thrown away.
        //
        // setupDone rather than onboardingCompleted: the latter is set when
        // the checklist that follows the card is dismissed, so the card
        // finishing is not what marks it.
        await expect(page.locator('.quickstart-setup')).toHaveCount(0);
        await expect.poll(() => page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const s = await (await f('/api/settings')).json();
            return { done: s.quickStart?.setupDone, autoDark: s.autoDarkMode };
        })).toEqual({ done: true, autoDark: true });
    });
});
