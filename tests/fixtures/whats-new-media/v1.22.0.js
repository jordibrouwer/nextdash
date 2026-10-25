// The highlights of v1.22.0: the new look, the backdrops with a quiet centre,
// and the cheat sheet you can search. See tests/whats-new-media.spec.js.
module.exports = {
    shots: [
        {
            slug: 'new-look',
            kind: 'image',
            alt: 'The nextDash dashboard in Aurora Glass: translucent columns over a soft backdrop',
            viewport: { width: 1280, height: 800 },
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
                await page.mouse.move(1270, 790);
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(800);
            },
        },
        {
            slug: 'quiet-centre',
            kind: 'video',
            alt: 'The theme studio on its Backdrop tab; the Quiet centre slider fades the pattern behind the bookmarks',
            viewport: { width: 1280, height: 800 },
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
                await page.keyboard.press('Shift+A');
                await page.locator('[data-look-studio] [data-theme-id]').first().waitFor();
                await page.locator('[data-look-studio] [data-studio-tab="backdrop"], [data-look-studio] [role="tab"]', { hasText: /Backdrop/ }).first().click();
                const choose = page.locator('[data-look-studio]').getByText('Choose one', { exact: false }).first();
                if (await choose.count()) await choose.click();
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(1_200);
                await page.locator('input[data-backdrop-tuning="calm"]').first().scrollIntoViewIfNeeded();
                await page.locator('input[data-backdrop-tuning="calm"]').first().evaluate((el) => {
                    el.value = '0';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                });
                // Pacing for the capture, not a condition: the backdrop fades while the slider moves.
                await page.waitForTimeout(600);
            },
            async act(page) {
                const slider = page.locator('input[data-backdrop-tuning="calm"]').first();
                for (const value of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
                    await slider.evaluate((el, v) => {
                        el.value = String(v);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }, value);
                    // Pacing for the capture, not a condition: the backdrop fades while the slider moves.
                    await page.waitForTimeout(450);
                }
                // Pacing for the capture, not a condition: the slider rests before the recording starts.
                await page.waitForTimeout(900);
            },
        },
        {
            slug: 'cheat-sheet',
            kind: 'video',
            alt: 'The cheat sheet: a word typed in the search field narrows the topics, and the dock shows the keys of the row picked',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('#app-modal.show .keyboard-cheat-sheet-modal').first(),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await settle(page);
            },
            async act(page) {
                await page.keyboard.press('!');
                await page.locator('#app-modal.show .keyboard-cheat-sheet-modal').waitFor();
                // Pacing for the capture, not a condition: the sheet gets time to be read before anything moves.
                await page.waitForTimeout(1_300);
                await page.keyboard.type('inbox', { delay: 170 });
                // Pacing for the capture, not a condition: the filter gets a moment to narrow the list.
                await page.waitForTimeout(900);
                await page.keyboard.press('ArrowDown');
                // Pacing for the capture, not a condition: the dock gets a moment to show the keys.
                await page.waitForTimeout(900);
                await page.keyboard.press('ArrowDown');
                // Pacing for the capture, not a condition: the last frame holds so the dock can be read.
                await page.waitForTimeout(1_400);
            },
        },
    ],
};
