// @ts-check
const { test, expect } = require('./fixtures');

/**
 * dashboard-config.js is the largest script in the app and the config view is a
 * separate destination, so it is fetched on first open rather than on every
 * dashboard load (dashboard-config-loader.js).
 *
 * These guard the two ways that goes wrong: the heavy module sneaking back into
 * the initial page load, and the loader stub drifting from the module it stands
 * in for — its mirrored section list is what parses a #config/<section> deep
 * link before the module exists.
 */
async function waitReady(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?.activeView !== undefined, null, { timeout: 5_000 });
}

test.describe('config lazy load', () => {
    test('the config module is not fetched on a plain dashboard load', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            if (req.url().includes('dashboard-config.js')) requested.push(req.url());
        });

        await page.goto('/');
        await waitReady(page);

        expect(requested).toEqual([]);
        // The stub stands in for it and the class itself is absent until opened.
        expect(await page.evaluate(() => typeof window.DashboardConfig)).toBe('undefined');
        expect(await page.evaluate(() => Boolean(window.dashboardInstance.config))).toBe(true);
    });

    test('opening config fetches the module once and renders the view', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            if (req.url().includes('dashboard-config.js')) requested.push(req.url());
        });

        await page.goto('/');
        await waitReady(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await expect(page.locator('.config-layout')).toBeVisible();
        expect(await page.evaluate(() => typeof window.DashboardConfig)).toBe('function');
        expect(requested).toHaveLength(1);
        // Content-hashed, so it can be cached immutably (asset_hash.go).
        expect(requested[0]).toMatch(/dashboard-config\.js\?v=[0-9a-f]+$/);

        // Re-opening must not fetch it a second time.
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await expect(page.locator('.config-layout')).toBeVisible();
        expect(requested).toHaveLength(1);
    });

    test('the loader mirrors the module section list', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        // Force the module in so both lists can be compared in one place.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await expect(page.locator('.config-layout')).toBeVisible();

        const { stub, module } = await page.evaluate(() => ({
            stub: window.DashboardConfigLoader.SECTIONS,
            module: window.DashboardConfig.SECTIONS,
        }));
        expect(stub).toEqual(module);
    });

    test('a deep link into a sub-tab survives the lazy load', async ({ page }) => {
        // The section is parsed by the stub and the sub-tab is buffered, then
        // both are replayed onto the module once it arrives.
        await page.goto('/#config/behavior/privacy');
        await waitReady(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('behavior');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.behaviorTab)).toBe('privacy');
    });

    test('a method call before the module loads still reaches it', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);

        // setBehavior lives only on the module; the loader forwards it and loads
        // on demand, so callers never have to know it was not there yet.
        await page.evaluate(() => window.dashboardInstance.config.setBehavior('dashboardTitle', 'lazy-load-probe', ''));
        await expect.poll(() => page.evaluate(() => typeof window.DashboardConfig)).toBe('function');
    });

    test('a plain value read on an unregistered property is a function, not the value', async ({ page }) => {
        // Documents a known, accepted sharp edge rather than guarding a fix:
        // the Proxy cannot tell a value read from the first half of a method
        // call, so it always returns a callable for an unknown property before
        // the module loads. That makes `if (dash.config.someUnregisteredFlag)`
        // always truthy — new boolean-style state that must be readable before
        // the module loads has to go in DashboardConfigLoader.PROXIED_STATE
        // instead of relying on this fallback. If this ever starts returning
        // the plain value instead, the "method call before the module loads"
        // test above must still be checked — that is the behaviour a fix here
        // would be trading away.
        await page.goto('/');
        await waitReady(page);

        const result = await page.evaluate(() => ({
            notLoadedYet: typeof window.DashboardConfig === 'undefined',
            type: typeof window.dashboardInstance.config.someUnregisteredProbeFlag,
        }));
        expect(result.notLoadedYet).toBe(true);
        expect(result.type).toBe('function');
    });

    /**
     * A section with a file and no id, or an id whose file never arrives, both
     * fail the same way at runtime: the reader opens a section and gets an
     * empty body. The table is small and hand-maintained, so it is checked
     * against the section list rather than trusted.
     */
    test('every section module names a real section, and declares how to tell it landed', async ({ page }) => {
        await page.goto('/#config/overview');
        await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 15_000 });

        const seen = await page.evaluate(() => {
            const C = window.DashboardConfig;
            return {
                sections: C.SECTIONS,
                modules: Object.entries(C.SECTION_MODULES).map(([id, entry]) => ({
                    id,
                    file: entry.file,
                    datasetKey: entry.datasetKey,
                    readyIsFunction: typeof entry.ready === 'function',
                })),
            };
        });

        expect(seen.modules.length).toBeGreaterThan(0);
        for (const mod of seen.modules) {
            expect(seen.sections, `${mod.id} has a file but is not a section`).toContain(mod.id);
            expect(mod.file, `${mod.id} names no file`).toMatch(/^js\/dashboard\/dashboard-config-[\w-]+\.js$/);
            expect(mod.datasetKey, `${mod.id} names no dataset key`).toBeTruthy();
            expect(mod.readyIsFunction, `${mod.id} has no ready() test`).toBe(true);
        }

        /*
         * Dataset keys are how LazyScript avoids fetching one file twice, so
         * two sections may share a key only when they genuinely share a file —
         * which is the arrangement About and Overview are planned to use.
         * Sharing a key across two different files would make the second
         * section believe the first section's script was its own, and it would
         * then never fetch anything.
         */
        const byKey = new Map();
        for (const mod of seen.modules) {
            if (!byKey.has(mod.datasetKey)) byKey.set(mod.datasetKey, new Set());
            byKey.get(mod.datasetKey).add(mod.file);
        }
        for (const [key, filesForKey] of byKey) {
            expect(filesForKey.size, `dataset key ${key} is used for ${[...filesForKey].join(' and ')}`).toBe(1);
        }
    });

    /**
     * The section's own file must not be in the page's script tags: if it is,
     * every dashboard load pays for it again and the split bought nothing.
     */
    test('a section module is not loaded with the page', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        const tagged = await page.evaluate(() => Array.from(document.scripts)
            .map((s) => s.getAttribute('src') || '')
            .filter((src) => /dashboard-config-(logs|help|overview|behavior|structure|data|widgets|appearance)\.js/.test(src)));
        expect(tagged, `section modules in the initial page: ${tagged.join(', ')}`).toEqual([]);
    });
});
