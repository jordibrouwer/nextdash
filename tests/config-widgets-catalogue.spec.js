// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * Adding a widget, and landing on the one you added.
 *
 * The catalogue used to sit open on the Widgets tab: measured at 900px on a
 * 900px viewport, which put the list of widgets you actually have at y=1312 —
 * 412px below the fold. Clicking a card added something you could not see, and
 * the only sign of it was a toast in the opposite corner. So the tab named
 * "Widgets" was three quarters catalogue, and the catalogue was the same
 * thirteen names and thirteen sentences the Types tab already carried.
 *
 * It is an overlay now, the way the theme browser answers the same question.
 * What this pins is the part that made it worth moving: after choosing, the
 * new row is on screen and holding the caret.
 */

async function openWidgets(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    // Quickstart's background favicon sweep reopens Overview when it finishes,
    // so this waited six seconds for it. waitForFaviconPrefetch waits for the
    // same thing by asking -- the overlay gone and nextdashSetupFaviconsDone no
    // longer false -- and returns the moment it is true instead of always
    // spending the worst case. dismissBlockingOverlays above already called it
    // once; a second call costs nothing when the sweep is already done and
    // covers the case where it was still running.
    await waitForFaviconPrefetch(page);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
    });
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
}

test.describe('the widget catalogue is a door, not the page', () => {
    test('the tab opens on the list, with no catalogue inlined', async ({ page }) => {
        await openWidgets(page);

        // Nothing yet, so the empty list is the invitation and carries the door.
        await expect(page.locator('.config-widget-empty')).toBeVisible();
        await expect(page.locator('.config-widget-empty [data-widget-catalogue]')).toBeVisible();
        // The cards live in the overlay only.
        await expect(page.locator('#config-widgets-body .config-widget-pick')).toHaveCount(0);
    });

    test('choosing a kind closes the overlay and leaves the new row in view', async ({ page }) => {
        await openWidgets(page);

        await page.locator('[data-widget-catalogue]').click();
        await expect(page.locator('.modal--widget-catalogue [data-widget-add]').first()).toBeVisible();

        await page.locator('.modal--widget-catalogue [data-widget-option="health"]').first().click();
        await page.locator('.modal--widget-catalogue [data-widget-add="health"]').click();
        await expect(page.locator('.modal--widget-catalogue')).toHaveCount(0);
        await expect(page.locator('.config-widget-row')).toHaveCount(1);

        // In view, not merely present: the whole complaint was a row that
        // existed below the fold. The row arrives with its settings open, so
        // what has to be on screen is the panel it opened rather than only the
        // head of the row.
        /*
         * Polled, because the reveal scrolls smoothly: reading the box in the
         * same tick measures where the row started rather than where it lands.
         *
         * What is asserted is that the row and the top of its settings are on
         * screen -- not that the whole panel fits. A row arrives with its
         * settings open, and on a 720px viewport a panel of several fields is
         * taller than the space left below the config chrome, so demanding
         * the whole of it fit is a test that can never pass rather than one
         * that catches the complaint: a new row landing below the fold.
         */
        await expect.poll(async () => page.evaluate(() => {
            const row = document.querySelector('.config-widget-row');
            const head = row.getBoundingClientRect();
            const panel = row.querySelector('.config-widget-settings:not([hidden])');
            const fields = panel ? panel.getBoundingClientRect() : head;
            return head.top >= 0 && head.top < window.innerHeight
                && fields.top < window.innerHeight;
        }), { timeout: 10_000 }).toBe(true);

        // And holding the caret, because naming it is the next thing anyone does.
        await expect(page.locator('.config-widget-row [data-widget="title"]')).toBeFocused();
    });

    /*
     * Adding one is almost always followed by filling it in, and the fields sat
     * behind a Settings button. Only one panel is open at a time, so on a page
     * that already carries a widget of the same kind that second click closed
     * the panel the reader was reading -- which is what made a second RSS block
     * feel like it could not be given feeds of its own.
     */
    test('the new widget arrives with its settings already open', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('.modal--widget-catalogue [data-widget-option="rss"]').first().click();
        await page.locator('.modal--widget-catalogue [data-widget-add="rss"]').click();

        const row = page.locator('.config-widget-row').filter({ hasText: 'RSS' });
        await expect(row).toHaveCount(1);
        // is-open in either layout: the button says aria-expanded when the
        // detail folds out under it, aria-pressed when it sits beside the list.
        await expect(row).toHaveClass(/is-open/);
        // The fields themselves, not just an expanded button.
        await expect(page.locator('.config-widget-detail textarea[data-widget-setting="feedUrls"]')).toBeVisible();

        // A second one of the same kind opens its own panel rather than
        // reopening the first, and each carries its own fields.
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('.modal--widget-catalogue [data-widget-option="rss"]').first().click();
        await page.locator('.modal--widget-catalogue [data-widget-add="rss"]').click();
        await expect(page.locator('.config-widget-row').filter({ hasText: 'RSS' })).toHaveCount(2);

        const open = page.locator('.config-widget-row.is-open [data-widget-settings]');
        await expect(open).toHaveCount(1);
        const areas = page.locator('textarea[data-widget-setting="feedUrls"]');
        await expect(areas).toHaveCount(1);
        // And it is the second widget's panel, not the first one reopened.
        const openIndex = await open.getAttribute('data-widget-settings');
        await expect(areas).toHaveAttribute('data-widget-index', openIndex);
    });

    test('the Custom widget is named, not spelled as its type', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widget-catalogue]').click();
        await expect(page.locator('.modal--widget-catalogue [data-widget-add]').first()).toBeVisible();

        // dashboard.widgetType.custom was missing from every locale, so the row
        // fell back to the raw type and read a lowercase "custom" among thirteen
        // proper names. Read with textContent: the row sits at the bottom of
        // the list's own scroll area, and innerText answers '' for anything
        // not currently rendered.
        const name = (await page.locator('[data-widget-option="custom"] .config-widget-picker-option-name')
            .textContent() || '').trim();
        expect(name).not.toBe('custom');
        expect(name).not.toBe('');
    });
});

/*
 * The picker: a list to search and a pane that shows the chosen kind.
 *
 * Driven from the keyboard the way a reader who knows what they want uses it:
 * the field has focus when the dialog opens, three letters narrow the list,
 * and Enter adds what is chosen.
 */
test.describe('the widget picker', () => {
    test('typing narrows the list and Enter adds the one chosen', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widget-catalogue]').click();

        const search = page.locator('.modal--widget-catalogue [data-widget-search]');
        await expect(search).toBeFocused();
        await page.keyboard.type('sab');

        const shown = page.locator('.modal--widget-catalogue [data-widget-option]:visible');
        await expect(shown).toHaveCount(1);
        await expect(shown).toHaveAttribute('data-widget-option', 'sabnzbd');
        await expect(page.locator('.config-widget-picker-preview')).toHaveAttribute('data-type', 'sabnzbd');

        await page.keyboard.press('Enter');
        await expect(page.locator('.modal--widget-catalogue')).toHaveCount(0);
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._module._widgetBlocks.filter((b) => b.isWidget).map((b) => b.type)))
            .toEqual(['sabnzbd']);
    });

    test('the arrows move the choice and the pane follows', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widget-catalogue]').click();
        await expect(page.locator('.modal--widget-catalogue [data-widget-search]')).toBeFocused();

        const before = await page.locator('.config-widget-picker-preview').getAttribute('data-type');
        await page.keyboard.press('ArrowDown');
        const after = await page.locator('.config-widget-picker-preview').getAttribute('data-type');
        expect(after).not.toBe(before);
        await expect(page.locator('.config-widget-picker-option.is-active'))
            .toHaveAttribute('data-widget-option', after || '');
        // The first Escape empties a field with text in it rather than closing.
        await page.keyboard.type('zzzz');
        await expect(page.locator('.config-widget-picker-empty')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.modal--widget-catalogue')).toHaveCount(1);
        await expect(page.locator('.modal--widget-catalogue [data-widget-search]')).toHaveValue('');
    });
});

/*
 * New kinds wear a badge, and lose it by themselves one minor release later.
 *
 * The release is read from the nextdash-release meta, so the test sets it
 * rather than depending on whichever release this checkout happens to be.
 */
test.describe('new widget kinds', () => {
    async function setRelease(page, tag) {
        await page.evaluate((value) => {
            let meta = document.querySelector('meta[name="nextdash-release"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.name = 'nextdash-release';
                document.head.appendChild(meta);
            }
            meta.content = value;
        }, tag);
    }

    const MEDIA = ['jellyfin', 'jellyfin-playing', 'emby', 'emby-playing', 'plex', 'plex-playing', 'sonarr', 'radarr', 'seerr', 'qbittorrent', 'sabnzbd', 'homeassistant'];

    test('the media kinds lead the picker with a New badge', async ({ page }) => {
        await openWidgets(page);
        await setRelease(page, 'v1.20.0');
        await page.locator('[data-widget-catalogue]').click();

        const strip = page.locator('.config-widget-picker-group--new [data-widget-option]');
        await expect(strip).toHaveCount(MEDIA.length);
        expect(await strip.evaluateAll((els) => els.map((el) => el.getAttribute('data-widget-option'))))
            .toEqual(MEDIA);
        await expect(page.locator('.config-widget-picker-group--new .config-widget-new-badge')).toHaveCount(MEDIA.length);
        // Opened without a kind asked for, the first new one is the one shown.
        await expect(page.locator('.config-widget-picker-preview .config-widget-new-badge')).toBeVisible();
        // An older kind carries none.
        await expect(page.locator('[data-widget-option="health"] .config-widget-new-badge')).toHaveCount(0);
    });

    test('the Catalogue tab shows them first, marked', async ({ page }) => {
        await openWidgets(page);
        await setRelease(page, 'v1.20.3');
        await page.locator('[data-widgets-tab="catalogue"]').click();

        const strip = page.locator('.config-widget-kind-group--new .config-widget-kind.is-new');
        await expect(strip).toHaveCount(MEDIA.length);
        await expect(page.locator('.config-widget-kind-group').first()).toHaveClass(/config-widget-kind-group--new/);
        await expect(page.locator('[data-widget-kind-filter="new"]')).toBeVisible();
    });

    test('a minor release later the badge is gone', async ({ page }) => {
        await openWidgets(page);
        await setRelease(page, 'v1.21.0');
        await page.locator('[data-widget-catalogue]').click();

        await expect(page.locator('.modal--widget-catalogue [data-widget-search]')).toBeFocused();
        await expect(page.locator('.config-widget-picker-group--new')).toHaveCount(0);
        await expect(page.locator('.modal--widget-catalogue .config-widget-new-badge')).toHaveCount(0);
    });
});
