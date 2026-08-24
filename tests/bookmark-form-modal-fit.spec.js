// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The add/edit bookmark modal fits on a normal laptop without scrolling.
 *
 * The bug: the dialog was capped at 90vh inside an overlay that already held
 * 24px of padding top and bottom, so it asked for 90% of a box that had 48px
 * taken off it. The form needs 735px; on an 800px-tall window the cap came out
 * at 720 and the body scrolled with 15px to spare. Common laptop heights (800,
 * 810) fell just under the line, so the modal grew a scrollbar for no visible
 * reason while the very same form sat still on a taller screen.
 */
async function openAddBookmark(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const handler = window.dashboardInstance.searchComponent
            ?.commandsComponent?.newCommandHandler;
        if (!handler) throw new Error('bookmark form handler missing');
        handler.openModal({});
    });
    await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
    // The icon prefetch repaints parts of the form; measuring before it settles
    // would measure a shorter form than the one the user ends up looking at.
    await page.waitForTimeout(700);
}

function overflow(page) {
    return page.evaluate(() => {
        const body = document.querySelector('.bookmark-form-modal-body');
        return body.scrollHeight - body.clientHeight;
    });
}

test.describe('bookmark form modal — fits without scrolling', () => {
    // 800 is the height that regressed: the old 90vh cap left 720px for a form
    // needing 735. 810 is the other common laptop height on the same edge.
    for (const height of [800, 810, 900]) {
        test(`no scrollbar at 1280x${height}`, async ({ page }) => {
            await page.setViewportSize({ width: 1280, height });
            await openAddBookmark(page);

            expect(await overflow(page)).toBe(0);
        });
    }

    test('the dialog stays inside the viewport, actions and all', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        const box = await page.evaluate(() => {
            const dialog = document.querySelector('.bookmark-form-modal-dialog');
            const rect = dialog.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
        });
        expect(box.top).toBeGreaterThanOrEqual(-1);
        expect(box.bottom).toBeLessThanOrEqual(box.viewport + 1);

        // The save row is the thing a scrollbar used to push out of reach.
        await expect(page.locator('.bookmark-inline-actions .bookmark-inline-save')).toBeInViewport();
    });

    // A window genuinely shorter than the form still has to scroll — the point
    // is that the modal never scrolls while the room is there, not that it
    // never scrolls at all. Narrow, because a wide window puts the fields in two
    // columns and 620px is no longer short for that.
    test('a viewport too short for the form still scrolls rather than clipping', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 620 });
        await openAddBookmark(page);

        expect(await overflow(page)).toBeGreaterThan(0);
        const reachable = await page.evaluate(() => {
            const body = document.querySelector('.bookmark-form-modal-body');
            body.scrollTop = body.scrollHeight;
            const actions = document.querySelector('.bookmark-inline-actions');
            const a = actions.getBoundingClientRect();
            const b = body.getBoundingClientRect();
            return a.bottom <= b.bottom + 2;
        });
        expect(reachable).toBe(true);
    });

    /*
     * Two columns where there is room for them.
     *
     * Eleven full-width fields made the form 735px tall to add and 763px to
     * edit. A 1366×768 laptop leaves around 660px once the browser has taken
     * its share, so the save row sat below the fold on the machine most people
     * use. The fields split into what the bookmark is and where it goes, which
     * are near enough the same height, and the dialog comes to about 450px.
     */
    test('the form is two columns on a wide window', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        const layout = await page.evaluate(() => {
            const cols = [...document.querySelectorAll('.bookmark-inline-col')];
            const boxes = cols.map((c) => c.getBoundingClientRect());
            const dialog = document.querySelector('.bookmark-form-modal-dialog').getBoundingClientRect();
            return {
                columns: cols.length,
                sameTop: Math.abs(boxes[0].top - boxes[1].top) < 2,
                sideBySide: boxes[1].left > boxes[0].right - 2,
                dialogHeight: Math.round(dialog.height),
            };
        });
        expect(layout.columns).toBe(2);
        expect(layout.sameTop).toBe(true);
        expect(layout.sideBySide).toBe(true);
        // 735 before. The margin is deliberate: this fails if the columns quietly
        // stack again, and passes for any reasonable change to the fields.
        expect(layout.dialogHeight).toBeLessThan(560);
    });

    // Short enough that the old stacked form could not have fitted at all.
    test('a 1366x768 laptop shows the whole form, save row included', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 680 });
        await openAddBookmark(page);

        expect(await overflow(page)).toBe(0);
        await expect(page.locator('.bookmark-inline-actions .bookmark-inline-save')).toBeInViewport();
    });

    /*
     * Below the breakpoint the columns dissolve.
     *
     * They are real elements so Tab runs down one and then the other; `display:
     * contents` is what lets the same markup be a single column on a narrow
     * window without a second form to keep in step.
     */
    test('a narrow window keeps the single column', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 900 });
        await openAddBookmark(page);

        const stacked = await page.evaluate(() => {
            const cols = [...document.querySelectorAll('.bookmark-inline-col')];
            const fields = [...document.querySelectorAll('.bookmark-inline-form .bookmark-inline-field')];
            const lefts = new Set(fields.map((f) => Math.round(f.getBoundingClientRect().left)));
            return {
                columnsDissolved: cols.every((c) => c.getBoundingClientRect().width === 0),
                distinctLefts: lefts.size,
            };
        });
        expect(stacked.columnsDissolved).toBe(true);
        expect(stacked.distinctLefts).toBe(1);
    });

    /*
     * The explanations are asked for, not printed.
     *
     * Pinned and Off / Periodic / Monitor say what they are, not what they do,
     * and the shortcut warning used to appear under the field mid-typing and
     * push everything below it down. All three are a bubble on the control now:
     * on hover, on focus and on tap, so the form itself stays empty.
     */
    test('pinned and availability explain themselves in a bubble', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        // Nothing of the sort is printed into the form.
        await expect(page.locator('.field-popover:not([hidden])')).toHaveCount(0);

        await page.locator('.bookmark-inline-toggle').first().hover();
        await expect(page.locator('.field-popover')).toContainText(/category/i);

        // The i names the choice and describes the mode that is currently set.
        await page.locator('.bookmark-inline-checkmode-info').hover();
        await expect(page.locator('.field-popover')).toContainText(/no availability checking/i);
        await page.locator('.bookmark-inline-checkmode-option').nth(2).click();
        await page.locator('.bookmark-inline-checkmode-info').hover();
        await expect(page.locator('.field-popover')).toContainText(/uptime history/i);

        await page.keyboard.press('Escape');
        await expect(page.locator('.field-popover')).toBeHidden();
    });

    // The warning that used to move the form as it appeared.
    test('a clashing shortcut warns in the bubble, not in the layout', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        // A filled-in form, so the only thing that can change the height is the
        // warning itself — an empty address legitimately shows its own error.
        await page.locator('#bookmark-form-modal .bookmark-inline-form input[data-field="url"]')
            .fill('https://example.com/shortcut-warning');
        await page.locator('#bookmark-form-modal .bookmark-inline-form input[data-field="name"]')
            .fill('Shortcut warning');
        const heightBefore = await page.evaluate(() => Math.round(
            document.querySelector('.bookmark-form-modal-dialog').getBoundingClientRect().height
        ));

        const shortcut = page.locator('#bookmark-form-modal .bookmark-inline-form input[maxlength="5"]');
        await shortcut.click();
        await shortcut.fill('G');

        const bubble = page.locator('.field-popover');
        await expect(bubble).toBeVisible();
        await expect(bubble).toHaveClass(/field-popover-warning/);
        await expect(shortcut).toHaveClass(/field-conflict/);

        const heightAfter = await page.evaluate(() => Math.round(
            document.querySelector('.bookmark-form-modal-dialog').getBoundingClientRect().height
        ));
        expect(heightAfter).toBe(heightBefore);
    });

    /*
     * The same treatment for the fields that validate.
     *
     * "Name is required" and "Valid URL required" were printed under their
     * fields, and on an empty Add form typing one character anywhere made the
     * other complain — 19 pixels of movement under the hands of whoever was
     * filling the form in.
     */
    test('an empty field warns in the bubble without moving the form', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        const height = () => page.evaluate(() => Math.round(
            document.querySelector('.bookmark-form-modal-dialog').getBoundingClientRect().height
        ));
        const before = await height();

        const name = page.locator('#bookmark-form-modal input[data-field="name"]');
        await name.click();
        await name.fill('Something');
        await name.fill('');

        const bubble = page.locator('.field-popover');
        await expect(bubble).toContainText(/name is required/i);
        await expect(bubble).toHaveClass(/field-popover-warning/);
        expect(await height()).toBe(before);

        // A refused save answers on the address, the field that is still empty.
        await name.fill('Something');
        await page.keyboard.press('Control+Enter');
        await expect(bubble).toContainText(/valid url/i);

        await page.locator('#bookmark-form-modal input[data-field="url"]').fill('https://example.com/ok');
        await expect(bubble).toBeHidden();
        expect(await height()).toBe(before);
    });

    /*
     * A phone gets the short form, and keeps what it does not show.
     *
     * Icon and Note are the two fields a phone is worst at: four buttons for a
     * favicon that is fetched anyway, and a textarea under a keyboard covering
     * half the screen. They are hidden rather than removed, so editing a
     * bookmark on a phone cannot drop the note or the icon it already had.
     */
    test('a phone hides icon and note but keeps their values', async ({ browser }) => {
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
        });
        const page = await context.newPage();
        try {
            await openAddBookmark(page);

            const shape = await page.evaluate(() => {
                const icon = document.querySelector('[data-field-block="icon"]');
                const note = document.querySelector('[data-field-block="note"]');
                return {
                    iconShown: icon.getBoundingClientRect().height > 0,
                    noteShown: note.getBoundingClientRect().height > 0,
                    iconInputPresent: Boolean(icon.querySelector('input')),
                    noteInputPresent: Boolean(note.querySelector('textarea')),
                    // Still one column, whatever the width says.
                    columnsDissolved: [...document.querySelectorAll('.bookmark-inline-col')]
                        .every((c) => c.getBoundingClientRect().width === 0),
                };
            });
            expect(shape).toEqual({
                iconShown: false,
                noteShown: false,
                iconInputPresent: true,
                noteInputPresent: true,
                columnsDissolved: true,
            });
        } finally {
            await context.close();
        }
    });

    // Adding starts on the address: it is the one field only you can supply, and
    // the name usually arrives with the page title. Editing still starts on the
    // name, which is what is nearly always being changed.
    test('the address has focus when the form opens to add', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        const focused = await page.evaluate(() => document.activeElement?.type || '');
        expect(focused).toBe('url');
    });
});
