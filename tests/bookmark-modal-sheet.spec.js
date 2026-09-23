// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The bookmark form is an overlay like the rest of them.
 *
 * It was the one panel outside the depth ladder: its own 12px corner, its own
 * flat 18/48 shadow, no lit edge, no shaded foot, and it never saw the glass
 * step whatever the reader chose. Every other overlay in the app draws the
 * same sheet — an 8px corner, the two edges, and a drop deep enough to say
 * the thing is above the page rather than resting on it.
 *
 * The ground stays near-opaque. It is the overlay tier of the glass tiers:
 * you type into this one, and what is behind it has no business showing
 * through.
 */

async function openForm(page, depth = 'rich') {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((d) => document.body.setAttribute('data-depth', d), depth);
    await page.keyboard.press('Shift+Equal');
    await page.waitForSelector('.bookmark-form-modal-dialog', { timeout: 20_000 });
}

const dialog = (page, props) => page.evaluate((list) => {
    const el = document.querySelector('.bookmark-form-modal-dialog');
    const cs = window.getComputedStyle(el);
    return Object.fromEntries(list.map((p) => [p, cs[p]]));
}, props);

const insets = (shadow) => shadow.split(/,(?![^(]*\))/).filter((p) => p.includes('inset')).length;


/**
 * The pixel value of a radius token, as the browser resolves it.
 *
 * A theme's character moves every corner now -- the fresh-install theme is
 * brushed and asks for 0.7 of the scale -- so the number to compare against is
 * the token, measured on an element that uses it, not a constant.
 */
const radiusPx = (page, token) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;left:-9999px;width:10px;height:10px;border-radius:var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).borderRadius;
    probe.remove();
    return value;
}, token);

test.describe('the bookmark form sheet', () => {
    test('takes the corner and the drop every overlay takes', async ({ page }) => {
        await openForm(page);
        const sheet = await dialog(page, ['borderRadius', 'boxShadow']);

        expect(sheet.borderRadius, 'the sheet kept a card corner')
            .toBe(await radiusPx(page, '--radius-5'));
        expect(sheet.boxShadow, `no deep drop under the sheet: ${sheet.boxShadow}`)
            .toMatch(/0px 24px 64px/);
    });

    test('and the two edges, once there is depth to draw them with', async ({ page }) => {
        await openForm(page, 'rich');
        const rich = await dialog(page, ['boxShadow']);
        expect(insets(rich.boxShadow), `expected a lit top and a shaded foot: ${rich.boxShadow}`)
            .toBeGreaterThanOrEqual(2);

        await page.evaluate(() => document.body.setAttribute('data-depth', 'flat'));
        const flat = await dialog(page, ['boxShadow']);
        expect(insets(flat.boxShadow), 'flat drew edges').toBe(0);
        // The drop stays: flat is about the ladder, not about whether an
        // overlay floats.
        expect(flat.boxShadow).toMatch(/0px 24px 64px/);
    });

    test('the glass step reaches it, at the overlay tier', async ({ page }) => {
        await openForm(page, 'rich');
        expect((await dialog(page, ['backdropFilter'])).backdropFilter,
            'rich blurs what is behind a form').toBe('none');

        await page.evaluate(() => document.body.setAttribute('data-depth', 'glass'));
        const glass = await dialog(page, ['backdropFilter']);
        expect(glass.backdropFilter, `glass did not reach the form: ${glass.backdropFilter}`)
            .toMatch(/blur\((?!0px)/);
    });

    test('the buttons are the foot of the sheet, not the last field', async ({ page }) => {
        await openForm(page);

        const actions = await page.evaluate(() => {
            const el = document.querySelector('.bookmark-form-modal-body .bookmark-inline-actions');
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return { borderTopWidth: cs.borderTopWidth, paddingTop: cs.paddingTop };
        });

        expect(actions, 'the form has no action row').not.toBeNull();
        expect(parseFloat(actions.borderTopWidth), 'no rule above the buttons').toBeGreaterThan(0);
        expect(parseFloat(actions.paddingTop), 'the rule sits on top of the buttons').toBeGreaterThan(4);
    });
});

/**
 * The form has three grounds, and they run the right way.
 *
 * The sheet used to be painted in the page colour, so the only thing saying it
 * was a sheet was the shadow under it -- and on a flat theme there is no
 * shadow. The fields were painted a step *lighter* than that, which put eleven
 * raised boxes on a surface that was not raised at all: the arrangement upside
 * down from every panel in the overlay spec and from every physical control
 * anyone has pressed.
 *
 * Now the sheet lifts off the page, the two groups lift off the sheet, and the
 * fields are cut back down to the page colour. Read as luminance rather than
 * as exact colours: what has to hold is the order, on any theme.
 */

const lum = (colour) => {
    // Two spellings reach here. `rgb(3, 7, 5)` counts channels to 255;
    // `color(srgb 0.05 0.07 0.05)` -- what a color-mix computes to -- counts
    // them to 1, and its colour-space name carries no digits, so both forms
    // put the three channels first.
    const m = (colour.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const scale = colour.startsWith('color(') ? 1 : 255;
    const [r, g, b] = m.map((v) => v / scale);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const grounds = (page) => page.evaluate(() => {
    const bg = (sel) => window.getComputedStyle(document.querySelector(sel)).backgroundColor;
    return {
        page: window.getComputedStyle(document.body).backgroundColor,
        sheet: bg('.bookmark-form-modal-dialog'),
        slab: bg('.bookmark-form-modal-body .bookmark-inline-col'),
        field: bg('.bookmark-form-modal-body .bookmark-inline-input'),
    };
});

for (const depth of ['rich', 'flat']) {
    test(`the sheet stands off the page, at ${depth} too`, async ({ page }) => {
        await openForm(page, depth);
        const g = await grounds(page);

        // Not the shadow doing the work: the colours themselves differ, which
        // is what a flat theme has left.
        expect(lum(g.sheet), `the sheet is the page colour at ${depth}`)
            .toBeGreaterThan(lum(g.page));
        expect(lum(g.slab), 'the groups do not lift off the sheet')
            .toBeGreaterThan(lum(g.sheet));
    });
}

test('and the fields are cut into it, not stacked on it', async ({ page }) => {
    await openForm(page);
    const g = await grounds(page);

    expect(lum(g.field), 'a field sits above the group holding it')
        .toBeLessThan(lum(g.slab));
    expect(lum(g.field), 'a field sits above the sheet holding it')
        .toBeLessThan(lum(g.sheet));
});

test('the two groups are one height, so the form reads as two columns', async ({ page }) => {
    await openForm(page);

    const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('.bookmark-form-modal-body .bookmark-inline-col')]
            .map((c) => {
                const r = c.getBoundingClientRect();
                return { top: Math.round(r.top), height: Math.round(r.height) };
            }));

    expect(boxes.length, 'the form is not in two groups').toBe(2);
    expect(boxes[0].top, 'one group starts lower than the other').toBe(boxes[1].top);
    // Two panels of different heights beside each other read as one panel and
    // a leftover, which is what the gap between them used to say.
    expect(boxes[0].height, 'the groups are different heights').toBe(boxes[1].height);
});

test('each group says what it is for', async ({ page }) => {
    await openForm(page);

    const titles = await page.locator('.bookmark-inline-group-title').allTextContents();
    expect(titles.length, 'the groups are unlabelled again').toBe(2);
    expect(titles[0].trim().length, 'a group title is empty').toBeGreaterThan(0);
});

test('the buttons stay at the foot rather than scrolling away', async ({ page }) => {
    await openForm(page);

    const position = await page.evaluate(() => window.getComputedStyle(
        document.querySelector('.bookmark-form-modal-body .bookmark-inline-actions')).position);

    // On a short window the form scrolls; what must not scroll out of reach is
    // the button that commits it.
    expect(position, 'the actions scroll with the fields').toBe('sticky');
});

test('the sheet names the key that opens it', async ({ page }) => {
    await openForm(page);

    const chip = await page.locator('.bookmark-form-modal-key').textContent();
    expect((chip || '').trim().length, 'the header has no key chip').toBeGreaterThan(0);
});

/**
 * Editing gets the same sheet as adding.
 *
 * One renderer draws both -- openBookmarkInlineEditor delegates straight to
 * openBookmarkFormModal -- so they cannot drift apart by accident. They can
 * drift by a rule scoped to one mode, which is what this catches.
 */
test('editing an existing bookmark gets the same sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Through the key someone presses, not through the renderer.
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => (
        (window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1) >= 0
    ), null, { timeout: 20_000 });
    await page.keyboard.press(';');
    await page.waitForSelector('.bookmark-form-modal.show .bookmark-inline-form', { timeout: 20_000 });

    const g = await grounds(page);
    expect(lum(g.sheet), 'the edit sheet is the page colour').toBeGreaterThan(lum(g.page));
    expect(lum(g.slab), 'the edit groups do not lift off the sheet').toBeGreaterThan(lum(g.sheet));
    expect(lum(g.field), 'an edit field sits above the group holding it').toBeLessThan(lum(g.slab));

    const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('.bookmark-form-modal-body .bookmark-inline-col')]
            .map((c) => Math.round(c.getBoundingClientRect().height)));
    expect(boxes.length, 'the edit form is not in two groups').toBe(2);
    expect(boxes[0], 'the edit groups are different heights').toBe(boxes[1]);

    // The chip names the key that was actually pressed to get here.
    expect((await page.locator('.bookmark-form-modal-key').textContent() || '').trim()).toBe(';');
});

/**
 * One filled button, and it is the one that commits the form.
 *
 * `bookmark-inline-save` is a style hook rather than the save button's name --
 * the Set URL button in the icon row wears it too. Filling every element
 * carrying the class put two identical green buttons in the form, so neither
 * of them was the primary action any more.
 */
test('only the button that saves is filled', async ({ page }) => {
    await openForm(page);

    await page.fill('.bookmark-form-modal-body [data-field="name"]', 'nextDash');
    await page.fill('.bookmark-form-modal-body [data-field="url"]', 'https://example.com');

    const filled = await page.evaluate(() => {
        const accent = window.getComputedStyle(document.body).getPropertyValue('--accent-primary').trim();
        const probe = document.createElement('span');
        probe.style.cssText = `position:fixed;left:-9999px;background:${accent}`;
        document.body.appendChild(probe);
        const want = window.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [...document.querySelectorAll('.bookmark-form-modal-body button')]
            .filter((b) => window.getComputedStyle(b).backgroundColor === want)
            .map((b) => (b.textContent || '').trim());
    });

    expect(filled.length, `more than one button is filled: ${filled.join(', ')}`).toBe(1);
});
