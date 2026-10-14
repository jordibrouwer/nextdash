const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, openConfigPanel } = require('./e2e-helpers');

/**
 * The list views arrive the way the tag view does: the header, rail and
 * toolbar rise in, then the rows one after another, and then hold still.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The elements matching `selector` that a running lvsRise animation is moving. */
function risingCount(page, selector) {
    return page.evaluate((sel) => document.getAnimations()
        .filter((a) => a.animationName === 'lvsRise' && a.effect?.target?.matches?.(sel))
        .length, selector);
}

/**
 * The tests share the dev data directory: put a setting back through the API.
 * Only the fields sent change; the server keeps the rest.
 */
function restoreSetting(page, field, value) {
    return page.evaluate(async ({ field, value }) => {
        // The page too: a later save of its settings would write the old value back.
        const d = window.dashboardInstance;
        if (d?.settings) d.settings[field] = value;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: value }),
        });
    }, { field, value });
}

const VIEWS = [
    {
        name: 'Bookmarks view',
        open: (page) => page.locator('.library-link-anchor').first().click(),
        header: '.config-view--library .lvs-header',
        row: '.config-bm-row',
    },
    {
        name: 'Inbox view',
        // Three items, so there are rows to come in one after another.
        prepare: (page) => page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const stamp = Date.now();
            for (let i = 0; i < 3; i += 1) {
                await api('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `https://rise${i}-${stamp}.example/x`, title: `Rise ${i}` }),
                });
            }
        }),
        // The tests share the dev data directory: take the items out again.
        cleanup: (page) => page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const items = await (await api('/api/inbox')).json();
            const list = Array.isArray(items) ? items : (items.items || []);
            for (const item of list.filter((i) => /^https:\/\/rise\d-/.test(i.url || ''))) {
                await api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            }
        }),
        open: (page) => page.locator('#page-nav-inbox-btn').click(),
        header: '.lvs-header',
        row: '.inbox-item',
    },
    {
        name: 'Containers view',
        setup: (page) => mockDocker(page),
        open: (page) => page.locator('#page-nav-docker-host a').click(),
        header: '.lvs-header',
        row: '.docker-row',
    },
];

for (const view of VIEWS) {
    test(`the ${view.name} rises in, then holds still`, async ({ page }) => {
        if (view.setup) await view.setup(page);
        await openDashboard(page);
        if (view.prepare) {
            await view.prepare(page);
            // The inbox reads its list at startup; a fresh load sees the seed.
            await openDashboard(page);
        }
        await view.open(page);

        await expect.poll(() => risingCount(page, view.row), { timeout: 3000, intervals: [20] }).toBeGreaterThan(1);
        expect(await risingCount(page, view.header)).toBeGreaterThan(0);
        // It is an arrival, not a state: the rows settle and stay put.
        await expect.poll(() => risingCount(page, `${view.header}, ${view.row}`), { timeout: 3000 }).toBe(0);
        await expect(page.locator('body')).not.toHaveAttribute('data-view-entering', /.+/);
        if (view.cleanup) await view.cleanup(page);
    });
}

test('with animations off a view arrives without moving', async ({ page }) => {
    await mockDocker(page);
    await openDashboard(page);
    await page.evaluate(() => document.body.classList.add('no-animations'));
    await page.locator('#page-nav-docker-host a').click();
    await expect(page.locator('.docker-row').first()).toBeVisible();
    expect(await risingCount(page, '.lvs-header, .docker-row')).toBe(0);
});

// The dashboard is where you work from, not a view you arrive at: coming
// back to it shows the grid at once.
test('back on the dashboard, the categories are simply there', async ({ page }) => {
    await mockDocker(page);
    await openDashboard(page);
    await page.locator('#page-nav-docker-host a').click();
    await expect(page.locator('.docker-row').first()).toBeVisible();
    await expect.poll(() => risingCount(page, '.docker-row'), { timeout: 3000 }).toBe(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
    expect(await risingCount(page, '#dashboard-layout .category')).toBe(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-view-entering', /.+/);
});

/** How long the rows' rise lasts, in ms, read off the running animations. */
function riseDuration(page, selector) {
    return page.evaluate((sel) => {
        const a = document.getAnimations().find((x) => x.animationName === 'lvsRise' && x.effect?.target?.matches?.(sel));
        return a ? a.effect.getComputedTiming().duration : null;
    }, selector);
}

async function openContainers(page) {
    await page.locator('#page-nav-docker-host a').click();
    await expect.poll(() => riseDuration(page, '.docker-row'), { timeout: 3000, intervals: [10] }).not.toBeNull();
    return riseDuration(page, '.docker-row');
}

test.describe('animation speed', () => {
    test('the middle step is the default, and quicker than the 300ms it was', async ({ page }) => {
        await mockDocker(page);
        await openDashboard(page);
        await expect(page.locator('body')).toHaveAttribute('data-animation-speed', 'normal');
        const ms = await openContainers(page);
        expect(ms).toBeLessThanOrEqual(160);
    });

    test('Fast in Appearance speeds it up, and stays after a reload', async ({ page }) => {
        await mockDocker(page);
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
        await page.click('[data-appearance-tab="general"]');
        await openConfigPanel(page, 'Text and motion');
        const select = page.locator('[data-appearance-select="animationSpeed"]');
        await expect(select).toHaveValue('normal');
        await expect(select.locator('option')).toHaveCount(3);

        try {
            await select.selectOption('fast');
            await expect(page.locator('body')).toHaveAttribute('data-animation-speed', 'fast');
            // Saved, not just shown: a fresh load still has it.
            await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/settings')).json()).animationSpeed)).toBe('fast');
            await openDashboard(page);
            await expect(page.locator('body')).toHaveAttribute('data-animation-speed', 'fast');
            const ms = await openContainers(page);
            expect(ms).toBeLessThanOrEqual(80);
        } finally {
            await restoreSetting(page, 'animationSpeed', 'normal');
            await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/settings')).json()).animationSpeed)).toBe('normal');
        }
    });
});

/** The running open transition on `selector`'s transform, as {duration} in ms. */
function openTransition(page, selector) {
    return page.evaluate((sel) => {
        // A transition on transform, or the modalRise keyframe for a modal
        // that is shown by switching display on.
        const t = document.getAnimations().find((a) => (a.transitionProperty === 'transform' || a.animationName === 'modalRise')
            && a.effect?.target?.matches?.(sel));
        return t ? Math.round(t.effect.getComputedTiming().duration) : null;
    }, selector);
}

test.describe('modals', () => {
    const MODALS = [
        { name: 'the cheat sheet', key: '!', panel: '.modal-overlay.show .modal' },
        { name: 'the bookmark form', key: '+', panel: '.bookmark-form-modal.show .bookmark-form-modal-dialog' },
        { name: 'the tag cloud', key: '/', panel: '#tag-cloud-modal' },
    ];

    for (const modal of MODALS) {
        test(`${modal.name} rises in like the tag cloud, at the default pace`, async ({ page }) => {
            await openDashboard(page);
            await page.locator('body').press(modal.key);
            await expect.poll(() => openTransition(page, modal.panel), { timeout: 3000, intervals: [10] }).not.toBeNull();
            // The cloud's 320ms at the Normal step.
            expect(await openTransition(page, modal.panel)).toBe(160);
        });
    }

    test('with Animations in views and modals off, a modal is simply there', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => document.body.classList.add('no-view-animations'));
        await page.locator('body').press('!');
        await expect(page.locator('.modal-overlay.show .modal').first()).toBeVisible();
        expect(await openTransition(page, '.modal-overlay.show .modal')).toBeNull();
    });
});

test('Animations in views and modals is a switch of its own beside Enable animations', async ({ page }) => {
    await mockDocker(page);
    await openDashboard(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
    await page.click('[data-appearance-tab="general"]');
    await openConfigPanel(page, 'Text and motion');
    const views = page.locator('[data-appearance-toggle="viewAnimationsEnabled"]');
    await expect(views).toBeChecked();
    try {
        await views.uncheck();
        await expect(page.locator('body')).toHaveClass(/no-view-animations/);
        // The site-wide switch is untouched.
        await expect(page.locator('[data-appearance-toggle="animationsEnabled"]')).toBeChecked();
        await expect(page.locator('body')).not.toHaveClass(/(^|\s)no-animations(\s|$)/);
        await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/settings')).json()).viewAnimationsEnabled)).toBe(false);
        await openDashboard(page);
        await page.locator('#page-nav-docker-host a').click();
        await expect(page.locator('.docker-row').first()).toBeVisible();
        expect(await risingCount(page, '.lvs-header, .docker-row')).toBe(0);
    } finally {
        await restoreSetting(page, 'viewAnimationsEnabled', true);
        await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/settings')).json()).viewAnimationsEnabled)).toBe(true);
    }
});

/**
 * The open motion on `selector`: its duration in ms, its curve and the scale
 * it starts from -- whether it runs as a transition or as a keyframe.
 */
function openMotion(page, selector) {
    return page.evaluate((sel) => {
        const a = document.getAnimations().find((x) => (x.transitionProperty === 'transform' || x.animationName)
            && x.effect?.target?.matches?.(sel)
            && (x.transitionProperty === 'transform' || /transform/.test(JSON.stringify(x.effect.getKeyframes()))));
        if (!a) return null;
        const frames = a.effect.getKeyframes();
        const first = frames.find((f) => f.transform) || {};
        const easing = a.transitionProperty ? a.effect.getComputedTiming().easing : (frames[0]?.easing || '');
        const m = /matrix\(([-\d.]+)/.exec(String(first.transform || ''));
        const scale = m ? Number(m[1]) : (/scale\(([\d.]+)\)/.exec(String(first.transform || ''))?.[1] ?? null);
        return { ms: Math.round(a.effect.getComputedTiming().duration), easing, scale: scale == null ? null : Number(scale) };
    }, selector);
}

// Every modal the action bar opens arrives the way the add-bookmark form does;
// the tag cloud keeps a motion of its own.
test.describe('modals from the action bar move like the add-bookmark form', () => {
    const BUTTONS = [
        { name: 'Add bookmark', button: '#quick-add-toolbar-btn', panel: '.bookmark-form-modal.show .bookmark-form-modal-dialog' },
        { name: 'Search', button: '#search-button', panel: '.shortcut-search.show .search-container' },
        { name: 'Commands', button: '#commands-button', panel: '.shortcut-search.show .search-container' },
        { name: 'Finders', button: '#finders-button', panel: '.shortcut-search.show .search-container' },
        { name: 'Recent', button: '#recent-bookmarks-button', panel: '.modal-overlay.show .modal.recent-bookmarks-modal' },
        { name: 'Pages', button: '#page-overview-header-btn', panel: '.modal-overlay.show .modal.page-overview-modal' },
        { name: 'Help', button: '#help-button', panel: '.modal-overlay.show .modal.keyboard-cheat-sheet-modal' },
    ];

    // In the header, and docked at the side, where Recent and Pages open as
    // sheets that keep their own centring.
    for (const position of ['header', 'right']) for (const b of BUTTONS) {
        test(`${b.name}, bar ${position}`, async ({ page }) => {
            await openDashboard(page);
            await page.evaluate(async (pos) => {
                const d = window.dashboardInstance;
                Object.assign(d.settings, { actionBarPosition: pos, maxHeaderActions: 9 });
                d.visual?.applyVisualSettings?.();
                await d.renderHeaderShortcuts?.();
            }, position);
            const button = page.locator(b.button);
            test.skip(!(await button.isVisible()), `${b.name} is not on the bar here`);
            await button.click();
            await expect.poll(() => openMotion(page, b.panel), { timeout: 3000, intervals: [10] }).not.toBeNull();
            const motion = await openMotion(page, b.panel);
            expect(motion.ms).toBe(160);
            expect(motion.easing).toBe('cubic-bezier(0.2, 0.9, 0.25, 1.05)');
            expect(motion.scale).toBeCloseTo(0.94, 2);
        });
    }
});
