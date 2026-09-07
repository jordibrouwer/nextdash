// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

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
        window.__lvsHandle.body.innerHTML =
            '<div class="feed-list"><article class="feed-row feed-row--grid" id="r1">'
            + '<span>i</span><span>title</span><span>meta</span></article></div>';
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
        return {
            feedRow: /\.feed-row--grid[^}]*grid-template-columns/s.test(await read('css/feed-row.css')),
            shell: /grid-template-columns:\s*3rem 1fr/.test(await read('css/list-view-shell.css')),
            inbox: /grid-template-columns:\s*3rem 1fr/.test(await read('css/dashboard-inbox.css')),
            health: /grid-template-columns:\s*3rem 1fr/.test(await read('css/health-view.css')),
        };
    });

    expect(where.feedRow, 'the grid must live in feed-row.css').toBe(true);
    expect(where.shell).toBe(false);
    expect(where.inbox).toBe(false);
    expect(where.health).toBe(false);
});

test('a grid row lays its columns out rather than stacking', async ({ page }) => {
    await mountWithDensity(page);
    const cols = await page.evaluate(() =>
        getComputedStyle(document.getElementById('r1')).gridTemplateColumns);
    expect(cols.split(' ').length, `grid resolved to "${cols}"`).toBe(3);
});

test('the density toggle changes row height and survives a reload', async ({ page }) => {
    await mountWithDensity(page);

    const comfortable = await page.evaluate(() =>
        document.getElementById('r1').getBoundingClientRect().height);

    await page.locator('[data-lvs-density="compact"]').click();
    const compact = await page.evaluate(() =>
        document.getElementById('r1').getBoundingClientRect().height);

    expect(compact, 'compact is not tighter than comfortable').toBeLessThan(comfortable);

    const stored = await page.evaluate(() => ({
        ls: localStorage.getItem('nextdash:list-density'),
        body: document.body.dataset.listDensity,
    }));
    expect(stored).toEqual({ ls: 'compact', body: 'compact' });

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    expect(await page.evaluate(() => document.body.dataset.listDensity)).toBe('compact');
});

test('density is one app-level setting, not one per view', async ({ page }) => {
    await mountWithDensity(page);
    await page.locator('[data-lvs-density="compact"]').click();

    // A second shell mounted elsewhere reads the same value.
    const second = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        window.ListViewShell.mount(host, { id: 'other', title: 'Other', description: '', density: true });
        return host.querySelector('[data-lvs-density="compact"]').getAttribute('aria-pressed');
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

test('unreadable storage falls back to the default without throwing', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    const value = await page.evaluate(() => {
        localStorage.setItem('nextdash:list-density', 'not-a-density');
        return window.ListDensity.get();
    });
    expect(value).toBe('comfortable');
});
