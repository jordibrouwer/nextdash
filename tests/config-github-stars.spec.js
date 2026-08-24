// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * The GitHub source panel in Config -> Data & backups.
 *
 * The styling assertions are here because this panel shipped once with
 * config-label, config-input and config-field-note on it -- three class names
 * that read like the house style and exist nowhere in the CSS, so the fields
 * and their hint rendered as unstyled browser defaults. Comparing against a
 * control that was already on the page catches that, where eyeballing a
 * screenshot did not.
 */
test.describe('GitHub stars source', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await expect(page.locator('#config-stars-token')).toBeVisible({ timeout: 15_000 });
    });

    test('its controls carry the same styling as the ones beside them', async ({ page }) => {
        const styleOf = (selector, props) => page.evaluate(([sel, list]) => {
            const el = document.querySelector(sel);
            if (!el) return 'MISSING';
            const c = getComputedStyle(el);
            return list.map((prop) => c[prop]).join('|');
        }, [selector, props]);

        const BUTTON = ['padding', 'borderWidth', 'borderRadius', 'fontSize'];
        // The CSV export button was on this panel before this feature existed.
        const reference = await styleOf('[data-backup-action="csv-export"]', BUTTON);
        expect(await styleOf('[data-backup-action="stars-save"]', BUTTON)).toBe(reference);
        expect(await styleOf('[data-backup-action="stars-run"]', BUTTON)).toBe(reference);

        /*
         * The inputs are compared against a .config-text elsewhere in config
         * rather than against each other: the original bug put the same wrong
         * class on both, so they matched each other perfectly while matching
         * nothing in the stylesheet.
         */
        const INPUT = ['padding', 'borderRadius', 'backgroundColor'];
        const textReference = await styleOf('.config-text', INPUT);
        expect(textReference).not.toBe('MISSING');
        expect(await styleOf('#config-stars-token', INPUT)).toBe(textReference);
        expect(await styleOf('#config-stars-category', INPUT)).toBe(textReference);

        /*
         * The hint and the label are placed by .config-field's grid, and that
         * placement is what a made-up class name loses: the hint spans the row
         * (grid-column 1 / -1) and the label sits in the first column. An
         * unstyled <p> and <label> in that grid get "auto" instead, which is
         * exactly how the panel shipped broken.
         */
        const placement = await page.evaluate(() => {
            const hint = getComputedStyle(document.getElementById('config-stars-token-note'));
            const label = getComputedStyle(document.querySelector('label[for="config-stars-token"]'));
            const body = getComputedStyle(document.body);
            return {
                hintColumn: hint.gridColumn,
                hintSize: parseFloat(hint.fontSize),
                labelColor: label.color,
                bodyColor: body.color,
                bodySize: parseFloat(body.fontSize),
            };
        });
        expect(placement.hintColumn).toBe('1 / -1');
        // Muted prose: smaller than body text rather than the same size.
        expect(placement.hintSize).toBeLessThan(placement.bodySize);
        // The label is styled, not inheriting the page's text colour.
        expect(placement.labelColor).not.toBe(placement.bodyColor);
    });

    test('the token goes in and never comes back', async ({ page }) => {
        await page.fill('#config-stars-token', 'ghp_e2e_secret');
        await page.fill('#config-stars-category', 'code');
        await page.click('[data-backup-action="stars-save"]');

        // Cleared after saving: a token still sitting in a form field is one
        // screenshot away from being shared.
        await expect(page.locator('#config-stars-token')).toHaveValue('');
        await expect(page.locator('#config-stars-token-note')).toContainText('token is saved');

        // And the API that the panel reads from does not hand it back.
        const listed = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await f('/api/sources')).text();
        });
        expect(listed).not.toContain('ghp_e2e_secret');
        expect(listed).toContain('"hasToken":true');
    });

    test('saving a category again keeps the token', async ({ page }) => {
        await page.fill('#config-stars-token', 'ghp_e2e_secret');
        await page.click('[data-backup-action="stars-save"]');
        await expect(page.locator('#config-stars-token-note')).toContainText('token is saved');

        /*
         * The form submits an empty token field, which must mean "unchanged".
         * Asserting on the note alone proves nothing -- it says "a token is
         * saved" either way, since a cleared token would just be an empty
         * string that hasToken reports as false only if it really was cleared.
         * So the check is the round that follows: a run with no token behind it
         * fails on the token, not on the network.
         */
        await page.fill('#config-stars-category', 'reading');
        await page.click('[data-backup-action="stars-save"]');

        const state = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const sources = await (await f('/api/sources')).json();
            return sources.find((s) => s.id === 'github:stars');
        });
        expect(state.hasToken).toBe(true);
        expect(state.targetCategory).toBe('reading');
    });
});
