// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markInboxTutorialSeen } = require('./e2e-helpers');

/**
 * The density setting, checked on the rows a view actually builds.
 *
 * This file used to mount a synthetic `<article class="feed-row feed-row--grid">`
 * of its own and measure that. It passed while `.feed-row--grid` reached no
 * production row at all: the inbox built `feed-row inbox-item` and answered the
 * density setting through a private copy of the rule in dashboard-inbox.css. A
 * test that builds its own subject can only tell you the CSS parses. So the row
 * tests below open the real inbox and measure a real row.
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

/** The real inbox, reached the way a reader reaches it. */
async function openInbox(page, titles = ['Alpha', 'Beta', 'Gamma']) {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const title of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://d-${title}-${Date.now()}.example/x`, title }),
            });
        }
    }, titles);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => document.querySelectorAll('.inbox-item').length)).toBeGreaterThan(0);
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

test('the inbox row is built on the shared grid variant', async ({ page }) => {
    await openInbox(page);

    const row = await page.evaluate(() => {
        const el = document.querySelector('.inbox-item');
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const thumb = el.querySelector('.inbox-item-thumb').getBoundingClientRect();
        const body = el.querySelector('.inbox-item-body').getBoundingClientRect();
        return {
            classes: [...el.classList],
            cols: cs.gridTemplateColumns,
            // The content edge the row's own padding and border leave.
            contentRight: box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
            bodyRight: body.right,
            thumbRight: thumb.right,
            bodyLeft: body.left,
        };
    });

    expect(row.classes, 'the real row must carry the shared grid variant')
        .toContain('feed-row--grid');
    // Icon column then body, side by side — not stacked.
    expect(row.thumbRight).toBeLessThanOrEqual(row.bodyLeft);
    expect(row.cols.split(' ').length, `grid resolved to "${row.cols}"`).toBe(2);
    // And no phantom trailing track: an empty `auto` column still takes its
    // gutter, which would leave a strip of dead space down the right of every
    // row. `.feed-row--grid-2` is what drops it.
    expect(Math.abs(row.contentRight - row.bodyRight),
        'the row body stops short of its content edge — an empty grid track is taking a gutter')
        .toBeLessThan(2);
});

test('density reaches the inbox row through feed-row.css alone', async ({ page }) => {
    await openInbox(page);

    // One mechanism, not two: the view's own copy of the density rule is gone.
    const inboxCopy = await page.evaluate(async () => {
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
        const css = await read('css/dashboard-inbox.css');
        return (css.match(/\[data-list-density=/g) || []).length;
    });
    expect(inboxCopy, 'dashboard-inbox.css declares density a second time').toBe(0);

    const height = () => page.evaluate(
        () => document.querySelector('.inbox-item').getBoundingClientRect().height);

    const comfortable = await height();
    await page.locator('[data-lvs-density="compact"]').click();
    const compact = await height();

    expect(compact, 'compact is not tighter than comfortable on a real inbox row')
        .toBeLessThan(comfortable);

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
