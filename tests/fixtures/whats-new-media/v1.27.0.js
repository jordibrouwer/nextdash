// The highlights of v1.27.0: the search panel with tags and your commands,
// one set of keys for every view, and the mode strip. See
// tests/whats-new-media.spec.js.
module.exports = {
    shots: [
        {
            slug: 'palette',
            kind: 'video',
            alt: 'The search panel opened with #: typing linux AND security narrows the bookmarks to those with both tags, then : lists the commands with Recent and Most used on top',
            async setup(page, { openDashboard }) {
                await openDashboard(page);
                // Two commands run the way a reader runs them, so Recent and
                // Most used have something to show. :legend twice leaves the
                // legend as it was.
                for (let i = 0; i < 2; i += 1) {
                    await page.keyboard.press(':');
                    await page.locator('.search-container').first().waitFor({ state: 'visible' });
                    // Pacing, not a condition: the panel loads its commands before the first letter.
                    await page.waitForTimeout(600);
                    await page.keyboard.type('legend', { delay: 60 });
                    await page.locator('.search-match', { hasText: /legend/i }).first().waitFor();
                    await page.keyboard.press('Enter');
                    // Pacing, not a condition: the command runs; the panel may stay open after it.
                    await page.waitForTimeout(500);
                    if (await page.locator('.search-container').first().isVisible()) await page.keyboard.press('Escape');
                    await page.locator('.search-container').first().waitFor({ state: 'hidden' });
                    // Pacing for the capture, not a condition: the panel closes and the legend redraws.
                    await page.waitForTimeout(500);
                }
            },
            async act(page) {
                await page.keyboard.press('#');
                await page.locator('.search-container').first().waitFor({ state: 'visible' });
                // Pacing for the capture, not a condition: the tags list draws.
                await page.waitForTimeout(900);
                await page.keyboard.type('linux AND secu', { delay: 120 });
                // Pacing for the capture, not a condition: the reader sees the completion offered.
                await page.waitForTimeout(700);
                await page.keyboard.type('rity', { delay: 120 });
                // Pacing for the capture, not a condition: the results settle.
                await page.waitForTimeout(1_400);
                // Back to an empty field, then the commands.
                for (let i = 0; i < 'linux AND security'.length + 1; i += 1) await page.keyboard.press('Backspace');
                await page.waitForTimeout(400);
                await page.keyboard.press(':');
                // Pacing for the capture, not a condition: the two lists draw.
                await page.waitForTimeout(1_500);
            },
        },
        {
            slug: 'keys',
            kind: 'video',
            alt: 'An arrow key puts the cursor on a bookmark, then ? opens Keys and help on This page, with the first steps and their Try it buttons',
            async setup(page, { openDashboard }) {
                await openDashboard(page);
            },
            async act(page) {
                await page.keyboard.press('ArrowDown');
                // Pacing for the capture, not a condition: the strip says Cursor.
                await page.waitForTimeout(1_000);
                await page.keyboard.press('j');
                await page.waitForTimeout(900);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
                await page.keyboard.press('?');
                await page.locator('#app-modal.show .keyboard-cheat-sheet').waitFor();
                // Pacing for the capture, not a condition: the sheet settles.
                await page.waitForTimeout(1_600);
            },
        },
        {
            slug: 'mode-strip',
            kind: 'video',
            alt: 'The mode strip beside the page name changes from Search to Cursor and suggests other letters as the cursor moves down a category',
            target: (page) => [page.locator('#mode-strip'), page.locator('.category').first()],
            async setup(page, { openDashboard }) {
                await openDashboard(page);
            },
            async act(page) {
                // Pacing for the capture, not a condition: the strip says Search first.
                await page.waitForTimeout(900);
                await page.keyboard.press('ArrowDown');
                await page.waitForTimeout(1_000);
                for (let i = 0; i < 3; i += 1) {
                    await page.keyboard.press('j');
                    await page.waitForTimeout(900);
                }
            },
        },
    ],
};
