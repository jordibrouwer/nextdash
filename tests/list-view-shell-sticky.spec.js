// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Phase 0 established that `position: sticky` works inside #dashboard-layout.
 * These tests hold that result in place and cover the collapse behaviour.
 */
async function mountTall(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 800 });
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
            id: 'scratch',
            title: 'Scratch',
            description: 'A test view',
            filters: [{ key: 'all', label: 'All', count: 1, dataAttrs: { 'data-scratch-filter': 'all' } }],
            activeFilter: 'all',
            actions: [
                { key: 'go', label: 'Work through', kind: 'primary', dataAttrs: { 'data-scratch-go': '' } },
                { key: 'more', label: '⋯', dataAttrs: { 'data-scratch-more': '' } },
            ],
        });
        window.__lvsHandle.body.innerHTML = '<div style="height:4000px">tall</div>';
    });
}

test('the header is sticky and stays on screen while the list scrolls', async ({ page }) => {
    await mountTall(page);

    const result = await page.evaluate(async () => {
        const header = document.querySelector('.lvs-header');
        const position = getComputedStyle(header).position;
        const before = header.getBoundingClientRect().top;
        window.scrollTo(0, 1200);
        await new Promise((r) => setTimeout(r, 400));
        const after = header.getBoundingClientRect().top;
        const scrolled = window.scrollY;
        window.scrollTo(0, 0);
        return { position, before, after, scrolled };
    });

    expect(result.position).toBe('sticky');
    expect(result.scrolled).toBeGreaterThan(0);
    expect(result.after, 'the header scrolled away instead of sticking').toBeLessThan(40);
});

test('the header collapses on scroll and expands again at the top', async ({ page }) => {
    await mountTall(page);

    const states = await page.evaluate(async () => {
        const header = document.querySelector('.lvs-header');
        const at = async (y) => {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 350));
            return header.classList.contains('is-collapsed');
        };
        const top = await at(0);
        const down = await at(1200);
        const back = await at(0);
        return { top, down, back };
    });

    expect(states).toEqual({ top: false, down: true, back: false });
});

test('the primary action stays reachable in the collapsed header', async ({ page }) => {
    await mountTall(page);

    const visible = await page.evaluate(async () => {
        window.scrollTo(0, 1200);
        await new Promise((r) => setTimeout(r, 350));
        const btn = document.querySelector('[data-scratch-go]');
        const box = btn.getBoundingClientRect();
        return { top: box.top, height: box.height, inView: box.top >= 0 && box.bottom <= window.innerHeight };
    });

    expect(visible.height).toBeGreaterThan(0);
    expect(visible.inView, 'the primary action left the viewport when collapsed').toBe(true);
});

test('the breadcrumb shows the active filter only when collapsed', async ({ page }) => {
    await mountTall(page);

    const seen = await page.evaluate(async () => {
        window.__lvsHandle.setBreadcrumb('Broken · 1');
        const crumb = document.querySelector('.lvs-crumb');
        const at = async (y) => {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 350));
            return getComputedStyle(crumb).display !== 'none';
        };
        return { text: crumb.textContent, top: await at(0), down: await at(1200) };
    });

    expect(seen.text).toBe('Broken · 1');
    expect(seen.top).toBe(false);
    expect(seen.down).toBe(true);
});

test('destroy detaches the scroll listener', async ({ page }) => {
    await mountTall(page);

    const leaked = await page.evaluate(async () => {
        window.__lvsHandle.destroy();
        let threw = null;
        window.onerror = (msg) => { threw = String(msg); };
        window.scrollTo(0, 800);
        await new Promise((r) => setTimeout(r, 300));
        window.scrollTo(0, 0);
        return threw;
    });

    expect(leaked, 'the scroll handler ran after destroy').toBeNull();
});

test('a bad-tone filter renders with a distinct colour from the default tone', async ({ page }) => {
    await mountTall(page);

    const colours = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const handle = window.ListViewShell.mount(host, {
            id: 'tone-scratch',
            title: 'Tone scratch',
            filters: [
                { key: 'default', label: 'Default', count: 0 },
                { key: 'bad', label: 'Bad', count: 0, tone: 'bad' },
            ],
            // Neither compared filter is active, so `.is-active` cannot
            // confound the colour comparison — only the tone class can.
            activeFilter: 'neither',
        });
        const defaultColor = getComputedStyle(host.querySelector('[data-lvs-filter-key="default"]')).color;
        const badColor = getComputedStyle(host.querySelector('[data-lvs-filter-key="bad"]')).color;
        handle.destroy();
        host.remove();
        return { defaultColor, badColor };
    });

    expect(colours.badColor, 'the bad-tone filter must render in a distinct colour').not.toBe(colours.defaultColor);
});
