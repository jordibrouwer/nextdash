// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The density setting, checked on the rows a view actually builds.
 *
 * This file used to mount a synthetic `<article class="feed-row feed-row--grid">`
 * of its own and measure that. It passed while `.feed-row--grid` reached no
 * production row at all: the inbox built `feed-row inbox-item` and answered the
 * density setting through a private copy of the rule in dashboard-inbox.css. A
 * test that builds its own subject can only tell you the CSS parses. The inbox
 * has since gone to one-line rows without the grid, so the row tests that
 * measured it went with it; what is here now is the setting and the shell.
 */
async function mountWithDensity(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
    await page.evaluate(() => {
        const host = document.getElementById('dashboard-layout');
        host.innerHTML = '';
        window.__lvsHandle = window.ListViewShell.mount(host, {
            id: 'scratch', title: 'Scratch', description: 'A test view', density: true,
            filters: [{ key: 'all', label: 'All', count: 1, dataAttrs: { 'data-scratch-filter': 'all' } }],
            activeFilter: 'all',
        });
    });
}

test('the row grid is declared in feed-row.css and nowhere else', async ({ page }) => {
    await mountWithDensity(page);

    const where = await page.evaluate(async () => {
        // NEXTDASH_BUNDLE concatenates bundle:css and bundle:css-views into
        // /static/bundle/dashboard.css and /static/bundle/views.css, each file's
        // content marked with a `/* ==== <path> ==== */` banner (see
        // buildBundle in internal/app/asset_bundle.go), so a plain href match
        // only works with bundling off. Same two shapes list-view-shell.spec.js
        // already checks for its own stylesheet-in-bundle test.
        const read = async (file) => {
            const hrefs = [...document.styleSheets].map((s) => s.href).filter(Boolean);
            const direct = hrefs.find((h) => h.includes(file));
            if (direct) return (await (await fetch(direct)).text());
            for (const href of hrefs) {
                if (!href.includes('/bundle/')) continue;
                const text = await (await fetch(href)).text();
                const marker = `/* ==== ${file} ==== */`;
                const start = text.indexOf(marker);
                if (start < 0) continue;
                const from = start + marker.length;
                const next = text.indexOf('/* ==== ', from);
                return text.slice(from, next < 0 ? undefined : next);
            }
            return '';
        };
        const feedRowCss = await read('css/feed-row.css');
        // The exact selector `.feed-row--grid {`, not `.feed-row--grid-3 {` —
        // the `-3` between `--grid` and the brace breaks the `\s*\{` match,
        // so this can only find --grid's own rule.
        const gridBlock = feedRowCss.match(/\.feed-row--grid\s*\{([^}]*)\}/);
        return {
            columnsLiveInFeedRow: /grid-template-columns:\s*3rem 1fr/.test(feedRowCss),
            // --grid must stay column-free: it and --with-select declare
            // grid-template-columns at equal specificity, so a third
            // declaration on --grid would win by source order and silently
            // drop the checkbox column again (the bug this file used to miss).
            gridModifierIsColumnFree: gridBlock ? !/grid-template-columns/.test(gridBlock[1]) : false,
            shell: /grid-template-columns:\s*3rem 1fr/.test(await read('css/list-view-shell.css')),
            inbox: /grid-template-columns:\s*3rem 1fr/.test(await read('css/dashboard-inbox.css')),
            health: /grid-template-columns:\s*3rem 1fr/.test(await read('css/health-view.css')),
        };
    });

    expect(where.columnsLiveInFeedRow, 'the grid must live in feed-row.css').toBe(true);
    expect(where.gridModifierIsColumnFree, '.feed-row--grid must not declare its own column tracks').toBe(true);
    expect(where.shell).toBe(false);
    expect(where.inbox).toBe(false);
    expect(where.health).toBe(false);
});

/*
 * The inbox row is off this list since the inbox went to one-line rows
 * (68520c39): it reads like the Bookmarks view's rows now, carries no
 * .feed-row--grid and no density toggle -- the queue already hid it. What is
 * left to guard is that the toggle a view does draw writes the one app setting.
 */
test('the density toggle writes the app-level setting, and it survives a reload', async ({ page }) => {
    await mountWithDensity(page);

    // From comfortable, explicitly: the app-wide default is compact, so
    // clicking compact from the default would change nothing.
    await page.locator('[data-lvs-density="comfortable"]').click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.densityMode)).toBe('comfortable');
    await page.locator('[data-lvs-density="compact"]').click();

    /*
     * The setting the whole app reads, not a key of this view's own.
     * Density used to live in localStorage for the list views and on the server
     * for the dashboard, with opposite defaults; it is one server setting now.
     */
    await expect.poll(() => page.evaluate(() => ({
        setting: window.dashboardInstance.settings.densityMode,
        body: document.body.dataset.densityMode,
        legacy: localStorage.getItem('nextdash:list-density'),
    }))).toEqual({ setting: 'compact', body: 'compact', legacy: null });

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    expect(await page.evaluate(() => document.body.dataset.densityMode)).toBe('compact');
});

test('density is one app-level setting, not one per view', async ({ page }) => {
    await mountWithDensity(page);
    // Not compact: that is the default, so a second shell would read it as
    // pressed whether or not the click reached anything.
    await page.locator('[data-lvs-density="comfortable"]').click();

    // A second shell mounted elsewhere reads the same value.
    const second = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        window.ListViewShell.mount(host, { id: 'other', title: 'Other', description: '', density: true });
        return host.querySelector('[data-lvs-density="comfortable"]').getAttribute('aria-pressed');
    });
    expect(second, 'the second view did not inherit the density setting').toBe('true');
});

test('a view filling its toolbar slot does not wipe the density toggle', async ({ page }) => {
    await mountWithDensity(page);

    const survived = await page.evaluate(() => {
        // Exactly what a view does when it builds its own toolbar controls.
        window.__lvsHandle.toolbar.innerHTML = '<input data-view-search>';
        return {
            viewControl: !!document.querySelector('[data-view-search]'),
            density: !!document.querySelector('[data-lvs-density="compact"]'),
        };
    });

    expect(survived.viewControl).toBe(true);
    expect(survived.density, 'the view wiped a shell-owned control').toBe(true);
});

test('a value nobody recognises falls back to the default without throwing', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });

    // Whatever is asked for, only the four the setting holds are answers.
    const value = await page.evaluate(() => {
        window.ListDensity.set('not-a-density');
        return window.ListDensity.get();
    });
    expect(value).toBe('compact');
});
