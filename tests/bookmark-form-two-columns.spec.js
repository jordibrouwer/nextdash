// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The add/edit bookmark modal in two columns.
 *
 * Left: the fields (url, name, tags, page > category, note). Right: the page as the dashboard
 * will show it (the preview card) with the options under it (shortcut, check mode, pinned).
 * Under 641px it is the single column it was. Under the signature the fields take the
 * material's own control corner; Classic does not.
 */

/**
 * The look is put on the page, not saved: a saved theme would reach the specs running beside
 * this one on the same server.
 */
async function setLook(page, theme, materialStyle) {
    await page.evaluate(async (look) => {
        window.ThemeLoader.applyTheme(look.theme);
        await window.ThemeLoader.applySurfacesForTheme(look.theme, {
            ...window.dashboardInstance.settings,
            materialStyle: look.materialStyle,
            themeSurfacesForceAll: true,
        });
    }, { theme, materialStyle });
}

async function openAdd(page, width = 1280, height = 800, look = ['arctic-cyan-dark', 'signature']) {
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ icon: '', title: 'Example page', description: 'What the page says about itself', image: '' }),
    }));
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await setLook(page, look[0], look[1]);
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    return page.locator('#bookmark-form-modal .bookmark-inline-form');
}

/** Left/right/top/bottom of the first match, in page pixels. */
function box(locator) {
    return locator.first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
}

test.describe('bookmark form, two columns', () => {
    test('at 1280 the url field and the preview card sit side by side, the options under the card', async ({ page }) => {
        const form = await openAdd(page);
        const url = await box(form.locator('[data-field="url"]'));
        const card = await box(form.locator('.bookmark-form-card'));
        expect(card.left).toBeGreaterThan(url.right);
        // The caption is above the card, in the same column.
        const label = await box(form.locator('.bookmark-form-card-label'));
        expect(label.left).toBeGreaterThan(url.right);
        expect(label.bottom).toBeLessThanOrEqual(card.top + 1);
        await expect(form.locator('.bookmark-form-card-label')).toHaveText('Preview on the dashboard');

        // Shortcut, the check chips and Pinned are in the right column, below the card.
        for (const target of [
            form.locator('[data-field="shortcut"]'),
            form.locator('.bookmark-inline-checkmode-option').first(),
            form.locator('.bookmark-inline-toggle').first(),
        ]) {
            await expect(target).toBeVisible();
            const b = await box(target);
            expect(b.left).toBeGreaterThan(url.right);
            expect(b.top).toBeGreaterThanOrEqual(card.bottom - 1);
        }

        // The note and page > category stay on the left, under the url.
        for (const target of [form.locator('[data-field="note"]'), form.locator('.bookmark-form-place-value')]) {
            const b = await box(target);
            expect(b.right).toBeLessThanOrEqual(card.left);
        }

        // The footer is still the foot of the sheet, below everything.
        const actions = await box(form.locator('.bookmark-inline-actions'));
        const note = await box(form.locator('[data-field="note"]'));
        expect(actions.top).toBeGreaterThanOrEqual(note.bottom);
    });

    test('at 500px everything is one column', async ({ page }) => {
        const form = await openAdd(page, 500, 900);
        const fields = ['[data-field="url"]', '[data-field="name"]', '[data-field="tags"]', '[data-field="shortcut"]', '[data-field="note"]'];
        const lefts = [];
        for (const sel of fields) {
            const b = await box(form.locator(sel));
            lefts.push(Math.round(b.left));
        }
        expect(new Set(lefts).size).toBe(1);
        // Stacked in the order they are filled in.
        const tops = [];
        for (const sel of fields.slice(0, 3)) tops.push((await box(form.locator(sel))).top);
        expect(tops).toEqual([...tops].sort((a, b) => a - b));
        const check = await box(form.locator('.bookmark-inline-checkmode-option').first());
        const url = await box(form.locator('[data-field="url"]'));
        expect(check.left).toBeLessThan(url.right);
        const columns = await form.locator('.bookmark-form-col').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(1);
    });

    test('the preview names the page after an address and a name are typed', async ({ page }) => {
        const form = await openAdd(page);
        await form.locator('[data-field="url"]').fill('https://example.com/post');
        await form.locator('[data-field="url"]').blur();
        const card = form.locator('.bookmark-form-card');
        // Until a name is typed, the page's own title stands in.
        await expect(card.locator('.bookmark-form-card-name')).toHaveText('Example page');
        await form.locator('[data-field="name"]').fill('My example');
        await expect(card.locator('.bookmark-form-card-name')).toHaveText('My example');
        await expect(card.locator('.bookmark-form-card-host')).toHaveText(/example\.com/);
        await expect(card.locator('.bookmark-form-card-desc')).toHaveText('What the page says about itself');
    });

    test('under the signature a field takes the material control corner, Classic does not', async ({ page }) => {
        const form = await openAdd(page);
        const read = () => form.locator('[data-field="url"]').evaluate((el) => {
            const control = getComputedStyle(document.body).getPropertyValue('--ov-r-control').trim();
            const probe = document.createElement('div');
            probe.style.borderRadius = control || '0px';
            document.body.appendChild(probe);
            const expected = getComputedStyle(probe).borderRadius;
            probe.remove();
            return { control, expected, radius: getComputedStyle(el).borderTopLeftRadius, ring: getComputedStyle(el).boxShadow };
        });
        const signature = await read();
        expect(signature.control).not.toBe('');
        expect(signature.radius).toBe(signature.expected);
        expect(signature.ring).toContain('inset');

        await setLook(page, 'arctic-cyan-dark', 'classic');
        const classic = await read();
        expect(classic.control).toBe('');
        expect(classic.radius).not.toBe(signature.radius);
    });

    test('the dialog panel takes the surface of the material under the signature', async ({ page }) => {
        await openAdd(page);
        const dialog = page.locator('.bookmark-form-modal-dialog');
        const radius = await dialog.evaluate((el) => {
            const probe = document.createElement('div');
            probe.style.borderRadius = 'var(--ov-radius)';
            document.body.appendChild(probe);
            const expected = getComputedStyle(probe).borderRadius;
            probe.remove();
            return { expected, actual: getComputedStyle(el).borderRadius };
        });
        expect(radius.actual).toBe(radius.expected);
    });
});
