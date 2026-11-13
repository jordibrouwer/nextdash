// The highlights of v1.29.0: where a block shows (a picture) and the column
// borders of the list views (a recording). The phone picture is the Status
// screen of the manual (screenshots/manual.md/23-phone-status.jpg), copied
// as media/v1.29.0-phone-tabbar.jpg. See tests/whats-new-media.spec.js.
module.exports = {
    shots: [
        {
            slug: 'show-on',
            kind: 'image',
            alt: 'The edit panel of a category, with the Show on choice: Everywhere, Desktop only and Phone only',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('#edit-mode-panel [data-edit-section="category"]'),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page);
                await page.keyboard.press('Shift+E');
                await page.locator('body[data-edit-mode="on"]').waitFor();
                await page.locator('#dashboard-layout .category[data-category-id="code"] .category-title').first().click();
                await page.locator('#edit-mode-panel [data-edit-section="category"]').waitFor();
                await settle(page);
                // Pacing for the capture, not a condition: the panel slides in.
                await page.waitForTimeout(800);
            },
        },
        {
            slug: 'resize-columns',
            kind: 'video',
            alt: 'The Bookmarks view: the border of the Tags column is dragged to the left, the column widens and the name column gives way',
            viewport: { width: 1440, height: 900 },
            target: (page) => page.locator('#config-bm-workbench'),
            async setup(page, { openDashboard, settle }) {
                await openDashboard(page, '#bookmarks');
                await page.locator('#config-bm-list .config-bm-row').first().waitFor();
                await settle(page);
                await page.locator('[data-bm-colhead] .config-bm-colhead-tags .cr-handle').waitFor();
            },
            async act(page) {
                const handle = page.locator('[data-bm-colhead] .config-bm-colhead-tags .cr-handle');
                const b = await handle.boundingBox();
                if (!b) throw new Error('handle has no box');
                const x = b.x + b.width / 2;
                const y = b.y + b.height / 2;
                await page.mouse.move(x, y, { steps: 6 });
                // Pacing for the recording: the pointer rests on the border first.
                await page.waitForTimeout(500);
                await page.mouse.down();
                await page.mouse.move(x - 90, y, { steps: 24 });
                await page.waitForTimeout(500);
                await page.mouse.move(x - 40, y, { steps: 12 });
                await page.mouse.up();
                await page.waitForTimeout(900);
            },
        },
    ],
};
