// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The line under a tab strip describes the open tab, not the first one.
 *
 * A tab switch repaints only the body under the strip. The note was drawn
 * once with the section, so after Backups → Sources in Data & backups it still
 * read "Snapshots of everything…". Statistics had already fixed this for its
 * own strip; Data & backups, Bookmarks and Help had not.
 */

async function openSection(page, section) {
    await markWhatsNewSeen(page);
    await page.goto(`/#config/${section}`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('#config-view-body .config-subtabs', { timeout: 20_000 });
}

const notes = (page) => page.locator('#config-view-body .config-tab-note');

const DB_NOTES = [
    ['sources', 'Bring bookmarks in from a browser or a file'],
    ['webhooks', 'Tell another service when something happens here'],
    ['icons', 'The favicons and page previews kept on this disk'],
    ['trash', 'What you deleted recently'],
    ['reset', 'Undo a whole area at once'],
    ['backups', 'Snapshots of everything'],
];

test.describe('the tab note follows the open tab', () => {
    test('Data & backups: each tab shows its own note', async ({ page }) => {
        await openSection(page, 'data-backups');
        await expect(notes(page)).toHaveCount(1);
        await expect(notes(page)).toContainText('Snapshots of everything');
        for (const [tab, text] of DB_NOTES) {
            await page.locator(`[data-db-tab="${tab}"]`).click();
            await expect(page.locator(`[data-db-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
            await expect(notes(page)).toHaveCount(1);
            await expect(notes(page)).toContainText(text);
        }
    });

    test('Bookmarks: the note comes and goes with tabs that have one', async ({ page }) => {
        await openSection(page, 'bookmarks');
        // View has no note of its own, so the section opens without one.
        await expect(page.locator('[data-bm-tab="view"]')).toHaveAttribute('aria-selected', 'true');
        await expect(notes(page)).toHaveCount(0);
        await page.locator('[data-bm-tab="tags"]').click();
        await expect(notes(page)).toHaveCount(1);
        await expect(notes(page)).toContainText('Rename a tag everywhere');
        await page.locator('[data-bm-tab="tag-rules"]').click();
        await expect(notes(page)).toContainText('Your own rules');
        await page.locator('[data-bm-tab="view"]').click();
        await expect(notes(page)).toHaveCount(0);
    });

    test('Help: the note in the search row follows the tab', async ({ page }) => {
        await openSection(page, 'help');
        await expect(notes(page)).toContainText('What nextDash is built around');
        await page.locator('[data-help-tab="search"]').click();
        await expect(notes(page)).toHaveCount(1);
        await expect(notes(page)).toContainText('Reaching anything from the keyboard');
        // It stays in the header row it shares with the search field.
        await expect(page.locator('.config-help-header > .config-tab-note')).toHaveCount(1);
    });
});
