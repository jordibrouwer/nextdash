// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Settings whose difference is a shape are drawn, not only described.
 *
 * "Snug — rows sit close together" is a sentence to decode and then try; three
 * stacks of bars at three gaps is answered before the sentence is read. The
 * drawings are stand-ins built from the same markup as the spread-across-columns
 * tour's visuals, so config, help and the tour draw a bookmark the same way —
 * and because the label beside each one already says it in words, none of them
 * is in the accessibility tree.
 */

async function openAppearance(page, tab) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 15_000 });
    // Through the tab strip, as a reader gets there: the tab is remembered
    // between visits, so setting it in code lands on whichever body was last
    // rendered often enough to look like the drawings are missing.
    await page.click(`[data-appearance-tab="${tab}"]`);
    await page.waitForTimeout(900);
}

test.describe('a choice you can see before you make it', () => {
    test('each spacing and margin card draws its own option', async ({ page }) => {
        await openAppearance(page, 'layout');

        for (const field of ['categorySpacing', 'sideMargin']) {
            const cards = page.locator(`.config-choice-card[data-behavior-field="${field}"]`);
            await expect(cards).toHaveCount(3);
            // Three cards, three drawings: a card with only a title and a
            // sentence is the thing this replaces.
            await expect(cards.locator('.setting-art')).toHaveCount(3);
        }

        // The drawings differ per option, or they are decoration rather than an
        // answer — the gap between the bands is the whole point.
        const classes = await page.locator('.config-choice-card[data-behavior-field="categorySpacing"] .setting-art-stack')
            .evaluateAll((els) => els.map((e) => e.className));
        expect(new Set(classes).size).toBe(3);
    });

    test('the column drawing follows the number as it is typed', async ({ page }) => {
        await openAppearance(page, 'layout');
        const art = page.locator('[data-behavior-art="columnsPerRow"]');
        await expect(art).toHaveCount(1);

        await page.locator('[data-behavior-field="columnsPerRow"]').first().fill('2');
        await expect.poll(() => art.locator('.setting-art-col').count(), { timeout: 5_000 }).toBe(2);

        await page.locator('[data-behavior-field="columnsPerRow"]').first().fill('5');
        await expect.poll(() => art.locator('.setting-art-col').count(), { timeout: 5_000 }).toBe(5);

        // Above six the columns would be thinner than their own rows, so it
        // caps and says there are more rather than drawing twelve hairs.
        await page.locator('[data-behavior-field="columnsPerRow"]').first().fill('12');
        await expect.poll(() => art.locator('.setting-art-col').count(), { timeout: 5_000 }).toBe(6);
        await expect(art.locator('.setting-art-more')).toHaveCount(1);
    });

    test('density draws the row spacing it sets', async ({ page }) => {
        await openAppearance(page, 'layout');
        const art = page.locator('[data-behavior-art="densityMode"] .setting-art-col');
        await page.locator('[data-behavior-field="densityMode"]').first().selectOption('dense');
        await expect(art).toHaveClass(/is-dense/, { timeout: 5_000 });
        await page.locator('[data-behavior-field="densityMode"]').first().selectOption('comfortable');
        await expect(art).toHaveClass(/is-comfortable/, { timeout: 5_000 });
    });

    test('the type sizes are shown at their own size, and the dots as dots', async ({ page }) => {
        await openAppearance(page, 'general');
        // Seven steps named Small to XL say nothing about what the grid will
        // look like; the letters do.
        const letters = page.locator('[data-appearance-font] .setting-art-type');
        await expect(letters).toHaveCount(7);
        const sizes = await letters.evaluateAll((els) =>
            els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
        expect(sizes[0]).toBeLessThan(sizes[sizes.length - 1]);

        const dots = page.locator('[data-appearance-art="showBackgroundDots"] .setting-art-dots');
        await expect(dots).toHaveCount(1);
        const before = await dots.getAttribute('class');
        await page.locator('[data-appearance-toggle="showBackgroundDots"]').click();
        await expect.poll(() => dots.getAttribute('class'), { timeout: 5_000 }).not.toBe(before);
    });
});

test.describe('help opens with a picture where the topic is a shape', () => {
    test('the panels that earn one have one, and the rest do not', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const withArt = async (tab) => {
            await page.evaluate((t) => {
                const c = window.dashboardInstance.config;
                c.openConfigView('help');
                c.helpTab = t;
                c.render();
            }, tab);
            // render() repaints the shell asynchronously; counting in the same
            // evaluate reads the body the previous tab left behind.
            await page.waitForTimeout(700);
            return page.locator('#config-help-body .config-help-art').count();
        };

        expect(await withArt('organizing')).toBe(1);
        expect(await withArt('inbox')).toBe(1);
        // Not everywhere: a drawing bolted onto a page about privacy is the
        // decoration this is meant to replace.
        expect(await withArt('stats')).toBe(0);
    });

    test('a drawing is never read out twice', async ({ page }) => {
        await openAppearance(page, 'layout');
        const exposed = await page.evaluate(() =>
            [...document.querySelectorAll('.setting-art')]
                .filter((el) => el.getAttribute('aria-hidden') !== 'true').length);
        // Every one sits beside the label that names it, so the drawing itself
        // has nothing to add for a screen reader.
        expect(exposed).toBe(0);
    });
});

test.describe('the settings that are a place, not a size', () => {
    test('each button-bar position draws the page with the bar in it', async ({ page }) => {
        await openAppearance(page, 'layout');
        const buttons = page.locator('[data-appearance-barpos]');
        await expect(buttons).toHaveCount(5);
        await expect(buttons.locator('.setting-art-screen')).toHaveCount(5);

        // Five names for five places and no page to point at: the drawings have
        // to differ, or they say nothing the names did not.
        const classes = await buttons.locator('.setting-art-screen')
            .evaluateAll((els) => els.map((e) => e.className));
        expect(new Set(classes).size).toBe(5);
    });

    test('Classic and Modern are drawn as the difference between them', async ({ page }) => {
        await openAppearance(page, 'layout');
        const shapes = page.locator('[data-appearance-layout] .setting-art-layout');
        await expect(shapes).toHaveCount(2);
        await expect(page.locator('[data-appearance-layout="classic"] .setting-art-layout')).toHaveClass(/is-classic/);
        await expect(page.locator('[data-appearance-layout="modern"] .setting-art-layout')).toHaveClass(/is-modern/);
    });

    test('the paste route is drawn, and forks where the setting forks', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.openConfigView('behavior');
            c.behaviorTab = 'search';
            c.render();
        });
        await page.waitForTimeout(800);

        const art = page.locator('[data-behavior-art="pasteDestination"]');
        await expect(art).toHaveCount(1);

        const select = page.locator('[data-behavior-field="pasteDestination"]').first();
        await select.selectOption('inbox');
        // One destination, one line.
        await expect.poll(() => art.locator('.setting-art-chip').count(), { timeout: 5_000 }).toBe(2);
        await expect(art.locator('.setting-art-branch')).toHaveCount(0);

        await select.selectOption('ask');
        // Asking each time ends in two places; drawn as one arrow after another
        // it would say the opposite of what it does.
        await expect(art.locator('.setting-art-branch')).toHaveCount(1);
        await expect.poll(() => art.locator('.setting-art-chip').count(), { timeout: 5_000 }).toBe(3);

        // The chips are words, so they are the reader's words.
        const dutch = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return c.artValue('pasteDestination', 'flow', 'inbox');
        });
        expect(dutch.length).toBe(2);
    });
});
