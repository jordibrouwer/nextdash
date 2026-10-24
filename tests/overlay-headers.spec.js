// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The head of a modal under a material's signature.
 *
 * With the theme's own category header (data-cat-head="theme") the modal head carries the same
 * slanted mark in front of its title and a rule under it. A header style the reader chose by name
 * leaves the mark out. Terminal sets its titles in capitals, paper in small capitals.
 *
 * Computed styles of the real confirm; no pixels.
 */
async function setLook(request, theme, head = 'theme') {
    const response = await request.post('/api/settings', {
        data: { theme, materialStyle: 'signature', categoryHeaderStyle: head },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok(), 'settings save failed').toBe(true);
}

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Opens a confirm and reads its head. */
async function head(page) {
    await page.evaluate(() => { window.AppModal.confirm({ title: 'Remove it?', message: 'Nothing is removed in this test.' }); });
    await page.waitForSelector('#app-modal.show .modal-header .modal-title');
    return page.evaluate(() => {
        const header = document.querySelector('#app-modal .modal-header');
        const title = document.querySelector('#app-modal .modal-title');
        const before = getComputedStyle(header, '::before');
        const cs = getComputedStyle(header);
        const t = getComputedStyle(title);
        return {
            catHead: document.body.getAttribute('data-cat-head'),
            material: document.body.getAttribute('data-material'),
            mark: before.content !== 'none' && before.content !== 'normal',
            markContent: before.content,
            borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle,
            transform: t.textTransform,
            caps: t.fontVariantCaps,
        };
    });
}

test.describe('the head of a modal under a material', () => {
    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', { data: { theme: 'look-ocean-dark', materialStyle: 'signature', categoryHeaderStyle: 'theme' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    test('the theme header puts the mark before the title and a rule under the head', async ({ page, request }) => {
        await setLook(request, 'cold-cathode-dark', 'theme');
        await openDashboard(page);
        const h = await head(page);
        expect(h.catHead).toBe('theme');
        expect(h.material).toBe('neon');
        expect(h.mark, 'no mark before the modal title').toBe(true);
        expect(h.markContent).toBe('""');
        expect(h.borderBottom, 'no rule under the modal head').toBe('1px solid');
    });

    test('a header style the reader chose leaves the mark out', async ({ page, request }) => {
        for (const style of ['clean', 'underlined', 'boxed']) {
            await setLook(request, 'cold-cathode-dark', style);
            await openDashboard(page);
            const h = await head(page);
            expect.soft(h.catHead, style + ': the setting did not arrive').toBe(style);
            expect.soft(h.mark, style + ': the modal head drew the theme mark').toBe(false);
            await page.evaluate(() => window.AppModal.hide?.());
        }
    });

    test('terminal sets the title in capitals', async ({ page, request }) => {
        await setLook(request, 'retro-crt-mk2-dark');
        await openDashboard(page);
        const h = await head(page);
        expect(h.material).toBe('terminal');
        expect(h.transform, 'terminal titles are not uppercase').toBe('uppercase');
    });

    test('paper sets the title in small capitals', async ({ page, request }) => {
        await setLook(request, 'candlelit-study-dark');
        await openDashboard(page);
        const h = await head(page);
        expect(h.material).toBe('paper');
        expect(h.caps, 'paper titles are not small-caps').toBe('small-caps');
    });

    test('classic draws none of it', async ({ page, request }) => {
        await request.post('/api/settings', { data: { theme: 'retro-crt-mk2-dark', materialStyle: 'classic', categoryHeaderStyle: 'theme' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
        await openDashboard(page);
        const h = await head(page);
        expect(h.mark, 'classic drew the mark').toBe(false);
        expect(h.transform, 'classic set the title in capitals').not.toBe('uppercase');
    });
});
