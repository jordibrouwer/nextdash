// The highlights of v1.22.5: the Recent sheet with its dates, and the tag view
// that shows any tag or every tag. See tests/whats-new-media.spec.js.
module.exports = {
    shots: [
        {
            slug: 'recent-sheet',
            kind: 'image',
            alt: 'The Recent bookmarks sheet: tiles two across, each with the day it was opened, its time and category, and a pager below',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('#app-modal.show .modal').first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
                await page.keyboard.press('*');
                await page.locator('#app-modal.show .recent-bookmarks-modal').waitFor();
                // Pacing for the capture, not a condition: the sheet's entrance gets time to finish.
                await page.waitForTimeout(900);
            },
        },
        {
            slug: 'tag-view-any-all',
            kind: 'video',
            alt: 'The tag view with news and security: the word between them turns from or to and, the list narrows, and Add tag… appears for a ticked row',
            viewport: { width: 1280, height: 800 },
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
                // A shared link is one of the ways in; it opens the view on both tags.
                await page.evaluate(() => { window.location.hash = '#tag/news+security'; });
                await page.locator('.tag-view-row').first().waitFor();
                await page.mouse.move(640, 760);
                // Pacing for the capture, not a condition: the table settles before the recording starts.
                await page.waitForTimeout(900);
            },
            async act(page) {
                // Pacing for the capture, not a condition: the reader sees the long list first.
                await page.waitForTimeout(900);
                await page.locator('[data-tag-view-mode]').first().click();
                // Pacing for the capture, not a condition: the list narrows to what carries both.
                await page.waitForTimeout(1_400);
                await page.locator('.tag-view-row').first().click({ modifiers: ['Alt'] });
                // Pacing for the capture, not a condition: the selection bar with Add tag… comes up.
                await page.waitForTimeout(1_200);
                await page.locator('.tag-view-selbar-add').first().hover();
                // Pacing for the capture, not a condition: the button is read before the recording ends.
                await page.waitForTimeout(1_000);
            },
        },
    ],
};
