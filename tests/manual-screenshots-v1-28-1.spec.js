// @ts-check
/*
 * The MANUAL.md screenshots of the Jellystat, Bazarr and Prowlarr widgets
 * (v1.28.1), each two columns wide so every part shows side by side. Same
 * harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-28-1.spec.js
 *
 * The answers are mocked in the shape the server sends, with invented titles
 * and names: a real server would put real titles and indexers in the picture.
 */
const { test, prepare, snap, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');
const { mockArrTiles } = require('./helpers/arr-tile-mocks');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });

test.describe('the Jellystat, Bazarr and Prowlarr tiles', () => {
    // Three tiles two columns wide stand below one another: a tall window shows them all, so no scrolling decides what is in the picture.
    test.use({ dataPatch: 'arrtiles', viewport: { width: 1440, height: 2200 } });

    test('15 jellystat bazarr prowlarr', async ({ page }) => {
        await prepare(page);
        await mockArrTiles(page);

        await openDashboard(page, '#4');
        const tile = (type) => page.locator(`[data-widget-type="${type}"]`).first();
        for (const type of ['jellystat', 'bazarr', 'prowlarr']) await tile(type).waitFor();
        // Pacing for the capture, not a condition: the tiles finish drawing.
        await page.waitForTimeout(800);
        // One tile at a time.
        for (const [type, name] of [['jellystat', '15-jellystat.jpg'], ['bazarr', '15-bazarr.jpg'], ['prowlarr', '15-prowlarr.jpg']]) {
            await snap(page, tile(type), name, { pad: 10 });
        }
    });
});

test('16 the widget picker with the media kinds', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // The address the picker has: the same one the Config → Widgets button opens.
    await page.goto('/#config/widgets/catalogue');
    const picker = page.locator('.modal--widget-catalogue');
    await picker.waitFor();
    // The Media group, with Bazarr chosen so the pane beside the list shows it.
    const option = picker.locator('[data-widget-option="bazarr"]').first();
    await option.scrollIntoViewIfNeeded();
    await option.click();
    // Pacing for the capture, not a condition: the pane beside the list redraws.
    await page.waitForTimeout(600);
    await snap(page, picker, '16-widget-picker.jpg', { pad: 0 });
});
