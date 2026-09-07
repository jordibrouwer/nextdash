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

const RAIL_CONFIG = {
    id: 'scratch',
    title: 'Scratch',
    description: 'A test view',
    summary: [
        { key: 'score', label: 'Score', value: '99%', tone: 'good' },
        { key: 'broken', label: 'Broken', value: 1, tone: 'bad' },
    ],
    filters: [
        { key: 'all', label: 'All', count: 108, dataAttrs: { 'data-scratch-filter': 'all' } },
        { key: 'broken', label: 'Broken', count: 1, tone: 'bad', dataAttrs: { 'data-scratch-filter': 'broken' } },
        { key: 'stale', label: 'Stale', count: 7, tone: 'warn', dataAttrs: { 'data-scratch-filter': 'stale' } },
    ],
    sections: [{ key: 'monitors', label: 'Monitors', count: 6 }],
    activeFilter: 'all',
};

const mountRail = (page, extra = {}) => page.evaluate((cfg) => {
    document.getElementById('__lvs_scratch__')?.remove();
    const host = document.createElement('div');
    host.id = '__lvs_scratch__';
    document.body.appendChild(host);
    window.__lvsCalls = [];
    const handle = window.ListViewShell.mount(host, {
        ...cfg,
        onFilter: (key, via) => window.__lvsCalls.push([key, via]),
    });
    window.__lvsHandle = handle;
    return true;
}, { ...RAIL_CONFIG, ...extra });

test('the rail renders summary, filters and sections as three blocks', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    const rail = await page.evaluate(() => {
        const host = document.getElementById('__lvs_scratch__');
        return {
            summary: [...host.querySelectorAll('.lvs-summary-row')].map((r) => ({
                label: r.querySelector('.lvs-summary-label').textContent,
                value: r.querySelector('.lvs-summary-value').textContent,
                tone: r.className,
            })),
            filters: [...host.querySelectorAll('.lvs-filter')].map((f) => ({
                label: f.querySelector('.lvs-filter-label').textContent,
                count: f.querySelector('.lvs-filter-count').textContent,
                active: f.classList.contains('is-active'),
                selected: f.getAttribute('aria-selected'),
                tabindex: f.getAttribute('tabindex'),
                dataAttr: f.getAttribute('data-scratch-filter'),
            })),
            sections: [...host.querySelectorAll('.lvs-section')].map((s) => s.textContent.trim()),
            tablist: host.querySelector('[role=tablist]') !== null,
        };
    });

    expect(rail.summary).toEqual([
        { label: 'Score', value: '99%', tone: expect.stringContaining('lvs-tone-good') },
        { label: 'Broken', value: '1', tone: expect.stringContaining('lvs-tone-bad') },
    ]);
    expect(rail.filters.map((f) => f.label)).toEqual(['All', 'Broken', 'Stale']);
    expect(rail.filters.map((f) => f.count)).toEqual(['108', '1', '7']);
    expect(rail.filters[0].active).toBe(true);
    expect(rail.filters[0].selected).toBe('true');
    expect(rail.filters[0].tabindex).toBe('0');
    expect(rail.filters[1].tabindex).toBe('-1');
    expect(rail.filters.map((f) => f.dataAttr), 'dataAttrs must be emitted verbatim')
        .toEqual(['all', 'broken', 'stale']);
    expect(rail.sections[0]).toContain('Monitors');
    expect(rail.tablist).toBe(true);
});

test('clicking and arrowing a filter reports through onFilter', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    await page.locator('[data-scratch-filter="stale"]').click();
    await page.locator('[data-scratch-filter="stale"]').press('ArrowRight');

    // ArrowRight from the last pill wraps to the first.
    expect(await page.evaluate(() => window.__lvsCalls))
        .toEqual([['stale', 'click'], ['all', 'keyboard']]);
});

test('setCounts and setActive update the rail without rebuilding it', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    const result = await page.evaluate(() => {
        const host = document.getElementById('__lvs_scratch__');
        const before = host.querySelector('[data-scratch-filter="all"]');
        before.dataset.mark = 'kept';
        window.__lvsHandle.setCounts({ all: 42, broken: 0, stale: 7 });
        window.__lvsHandle.setActive('broken');
        const after = host.querySelector('[data-scratch-filter="all"]');
        return {
            sameNode: before === after,
            markSurvived: after.dataset.mark === 'kept',
            counts: [...host.querySelectorAll('.lvs-filter-count')].map((c) => c.textContent),
            activeKey: host.querySelector('.lvs-filter.is-active')?.getAttribute('data-scratch-filter'),
            allTabindex: after.getAttribute('tabindex'),
        };
    });

    expect(result.sameNode, 'setCounts replaced the filter node instead of updating it').toBe(true);
    expect(result.markSurvived).toBe(true);
    expect(result.counts).toEqual(['42', '0', '7']);
    expect(result.activeKey).toBe('broken');
    expect(result.allTabindex).toBe('-1');
});

test('a view can add its own class names to the filter rows', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page, { filterClass: 'inbox-filter-btn', filterCountClass: 'inbox-filter-count' });

    // Specs select `[data-inbox-filter="all"] .inbox-filter-count`, so the
    // view's class has to ride along with the shell's.
    const classes = await page.evaluate(() => {
        const btn = document.querySelector('[data-scratch-filter="all"]');
        return {
            btn: [...btn.classList],
            count: [...btn.querySelector('.lvs-filter-count').classList],
        };
    });
    expect(classes.btn).toEqual(expect.arrayContaining(['lvs-filter', 'inbox-filter-btn']));
    expect(classes.count).toEqual(expect.arrayContaining(['lvs-filter-count', 'inbox-filter-count']));
});

test('setSummary rewrites the figures in place', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    const values = await page.evaluate(() => {
        window.__lvsHandle.setSummary([{ key: 'score', label: 'Score', value: '87%', tone: 'warn' }]);
        const host = document.getElementById('__lvs_scratch__');
        return [...host.querySelectorAll('.lvs-summary-row')].map((r) => ({
            value: r.querySelector('.lvs-summary-value').textContent,
            tone: r.className,
        }));
    });
    expect(values).toEqual([{ value: '87%', tone: expect.stringContaining('lvs-tone-warn') }]);
});

test('the rail keeps its scroll position across a body repaint', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page, {
        filters: Array.from({ length: 30 }, (_, i) => ({
            key: `f${i}`, label: `Filter ${i}`, count: i,
            dataAttrs: { 'data-scratch-filter': `f${i}` },
        })),
        activeFilter: 'f0',
    });

    const kept = await page.evaluate(() => {
        const rail = document.querySelector('.lvs-rail');
        rail.style.maxHeight = '120px';
        rail.style.overflowY = 'auto';
        rail.scrollTop = 60;
        const before = rail.scrollTop;
        window.__lvsHandle.body.innerHTML = '<p>repainted</p>';
        window.__lvsHandle.setCounts({ f0: 999 });
        return { before, after: document.querySelector('.lvs-rail').scrollTop };
    });
    expect(kept.after, 'the rail lost its scroll position').toBe(kept.before);
});
