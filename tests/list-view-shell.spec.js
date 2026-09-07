// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The shell owns everything that persists; a view owns only `handle.body`.
 * These tests drive the module directly on a scratch container, because at this
 * point no view has adopted it yet.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
}

/** Mounts the shell on a throwaway container and returns a structural summary. */
const mountScratch = (page, config) => page.evaluate((cfg) => {
    const host = document.createElement('div');
    host.id = '__lvs_scratch__';
    document.body.appendChild(host);
    const handle = window.ListViewShell.mount(host, cfg);
    window.__lvsHandle = handle;
    const q = (sel) => host.querySelector(sel);
    return {
        hostClass: host.className,
        hostDataId: host.getAttribute('data-lvs-id'),
        hasRoot: !!q('.lvs'),
        hasHeader: !!q('.lvs-header'),
        hasRail: !!q('.lvs-rail'),
        hasMain: !!q('.lvs-main'),
        hasToolbar: !!q('.lvs-toolbar'),
        hasToolbarSlot: !!q('.lvs-toolbar-slot'),
        toolbarIsSlot: handle.toolbar === q('.lvs-toolbar-slot'),
        hasBody: !!q('.lvs-body'),
        title: q('.lvs-title')?.textContent || '',
        description: q('.lvs-description')?.textContent || '',
        bodyIsHandleBody: handle.body === q('.lvs-body'),
        rootIsHandleRoot: handle.root === q('.lvs'),
    };
}, config);

test('mount builds every region and hands back the body element', async ({ page }) => {
    await openDashboard(page);
    const shape = await mountScratch(page, { id: 'scratch', title: 'Scratch', description: 'A test view' });

    expect(shape.hasRoot).toBe(true);
    expect(shape.hasHeader).toBe(true);
    expect(shape.hasRail).toBe(true);
    expect(shape.hasMain).toBe(true);
    expect(shape.hasToolbar).toBe(true);
    expect(shape.hasToolbarSlot).toBe(true);
    expect(shape.toolbarIsSlot, 'handle.toolbar must be the slot, not the row').toBe(true);
    expect(shape.hasBody).toBe(true);
    expect(shape.title).toBe('Scratch');
    expect(shape.description).toBe('A test view');
    expect(shape.hostClass).toContain('lvs-host');
    expect(shape.hostDataId).toBe('scratch');
    expect(shape.bodyIsHandleBody, 'handle.body must be the .lvs-body node').toBe(true);
    expect(shape.rootIsHandleRoot, 'handle.root must be the .lvs node').toBe(true);
});

test('the body is the only region a repaint touches', async ({ page }) => {
    await openDashboard(page);
    await mountScratch(page, { id: 'scratch', title: 'Scratch', description: 'A test view' });

    // Mark every region, wipe the body the way a view does, and check the marks.
    const survived = await page.evaluate(() => {
        const host = document.getElementById('__lvs_scratch__');
        const regions = ['.lvs-header', '.lvs-rail', '.lvs-toolbar'];
        regions.forEach((sel, i) => { host.querySelector(sel).dataset.mark = String(i); });
        const body = window.__lvsHandle.body;
        body.innerHTML = '<p>repainted</p>';
        return regions.map((sel, i) => host.querySelector(sel)?.dataset.mark === String(i));
    });
    expect(survived, 'a body repaint destroyed a persistent region').toEqual([true, true, true]);
});

test('destroy removes the shell and its host marks', async ({ page }) => {
    await openDashboard(page);
    await mountScratch(page, { id: 'scratch', title: 'Scratch', description: 'A test view' });

    const after = await page.evaluate(() => {
        window.__lvsHandle.destroy();
        const host = document.getElementById('__lvs_scratch__');
        return {
            hasRoot: !!host.querySelector('.lvs'),
            hostClass: host.className,
            hostDataId: host.getAttribute('data-lvs-id'),
        };
    });
    expect(after.hasRoot).toBe(false);
    expect(after.hostClass).not.toContain('lvs-host');
    expect(after.hostDataId).toBeNull();
});

test('the stylesheet is in the lazily loaded view bundle', async ({ page }) => {
    await openDashboard(page);
    // NEXTDASH_BUNDLE concatenates the whole bundle:css-views block into one
    // file (/static/bundle/views.css) with a banner comment per source file, so
    // a plain href match only works with bundling off. Check both shapes: the
    // individual tag (bundling off) or the banner inside the bundle (bundling on).
    const loaded = await page.evaluate(async () => {
        const hrefs = [...document.styleSheets].map((s) => s.href).filter(Boolean);
        for (const href of hrefs) {
            if (href.includes('css/list-view-shell.css')) return true;
            if (href.includes('bundle/views.css')) {
                const text = await (await fetch(href)).text();
                if (text.includes('css/list-view-shell.css')) return true;
            }
        }
        return false;
    });
    expect(loaded, 'list-view-shell.css is not in bundle:css-views').toBe(true);
});
