// @ts-check
const base = require('@playwright/test');
const { startWorkerServer } = require('./worker-server');
const { markWhatsNewSeen, dismissBlockingOverlays, markConfigSettingPromosSeen } = require('./e2e-helpers');

const { expect } = base;

/**
 * The public demo counts its visits into a Umami website of its own.
 *
 * A demo server of its own (NEXTDASH_DEMO=1 with the demo's website id), and
 * stats.nextdash.cc stubbed: nothing here reaches the real host, and
 * `window.umami` is a recorder, so what the page would have sent is what is
 * asserted. The rule that the shared website's id never lands on a demo page,
 * and the demo's never on a normal one, is pinned in Go (telemetry_test.go).
 */
const DEMO_ID = '257bdc36-89c5-4fdd-9e3a-401599dc1005';
const SHARED_ID = '6088e50e-b155-4efc-bc19-c4754edbbab1';

const test = base.test.extend({
    demoServer: [async ({}, use, workerInfo) => {
        const server = await startWorkerServer(2000 + workerInfo.workerIndex, {
            NEXTDASH_DEMO: '1',
            NEXTDASH_DEMO_ANALYTICS_ID: DEMO_ID,
            NEXTDASH_DISABLE_PREFETCH: '1',
        });
        await use(server);
        await server.stop();
    }, { scope: 'worker' }],
    // The control: an ordinary install, not the demo.
    normalServer: [async ({}, use, workerInfo) => {
        const server = await startWorkerServer(3000 + workerInfo.workerIndex, { NEXTDASH_DISABLE_PREFETCH: '1' });
        await use(server);
        await server.stop();
    }, { scope: 'worker' }],
});

/** The tracker as a recorder, and the recorder script as nothing. */
async function stubStats(page) {
    await page.context().route('https://stats.nextdash.cc/**', (route) => {
        const url = route.request().url();
        if (url.endsWith('/script.js')) {
            /*
             * Umami's tracker as far as the page's addresses go: it sends one
             * payload per pageview, hooks pushState/replaceState, applies
             * data-exclude-search, then hands the payload to the function named
             * by data-before-send (which may change it or drop it).
             */
            return route.fulfill({
                contentType: 'application/javascript',
                body: `(() => {
                    const self = document.currentScript;
                    const hook = self.getAttribute('data-before-send');
                    const noSearch = self.getAttribute('data-exclude-search') === 'true';
                    window.__sent = [];
                    const send = (type, payload) => {
                        const p = { ...payload };
                        if (noSearch && p.url) { const u = new URL(p.url); u.search = ''; p.url = u.toString(); }
                        const out = hook && typeof window[hook] === 'function' ? window[hook](type, p) : p;
                        if (out) window.__sent.push(out);
                    };
                    for (const m of ['pushState', 'replaceState']) {
                        const original = history[m];
                        history[m] = function (...a) { const r = original.apply(this, a); send('event', { url: location.href }); return r; };
                    }
                    send('event', { url: location.href });
                    window.umami = {
                        track(name, props) {
                            (window.__umami = window.__umami || []).push({ name, props });
                            send('event', { name, data: props, url: location.href });
                        },
                        getSession() { return { cache: 'stub' }; },
                    };
                })();`,
            });
        }
        if (url.endsWith('/recorder.js')) {
            return route.fulfill({ contentType: 'application/javascript', body: '' });
        }
        return route.fulfill({ status: 204, body: '' });
    });
    // The Install link opens the project's site in a new tab.
    await page.context().route('https://nextdash.cc/**', (route) => route.abort());
}

const umamiCalls = (page) => page.evaluate(() => window.__umami || []);
const named = async (page, name) => (await umamiCalls(page)).filter((c) => c.name === name);

async function openDemo(page, demoServer, { resetNote = false } = {}) {
    await stubStats(page);
    await markWhatsNewSeen(page);
    if (resetNote) {
        await page.addInitScript(() => sessionStorage.setItem('nextdash:demo-was-reset', '1'));
    }
    await page.goto(`${demoServer.baseURL}/`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForSelector('#demo-bar', { timeout: 10_000 });
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

test.describe('demo analytics', () => {
    test('the page counts into the demo website only, with the recorder, and says so', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);

        const tags = await page.evaluate(() => [...document.querySelectorAll('script[data-website-id]')].map((s) => ({
            src: s.getAttribute('src'),
            id: s.getAttribute('data-website-id'),
            mode: s.getAttribute('data-mode'),
            dnt: s.getAttribute('data-do-not-track'),
        })));
        const tracker = tags.find((t) => (t.src || '').endsWith('/script.js'));
        const recorder = tags.find((t) => (t.src || '').endsWith('/recorder.js'));
        expect(tracker).toMatchObject({ id: DEMO_ID, mode: 'demo', dnt: 'true' });
        expect(recorder).toMatchObject({ id: DEMO_ID, dnt: 'true' });
        expect(tags.every((t) => t.id !== SHARED_ID)).toBe(true);
        expect(await page.content()).not.toContain(SHARED_ID);

        // The notice the visitor reads, in the bar.
        await expect(page.locator('#demo-bar .demo-bar-notice')).toContainText('records visits anonymously');
        await expect(page.locator('#demo-bar .demo-bar-notice')).toContainText('masked');
    });

    test('Config shows the Privacy switches locked, with the demo\'s own text', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').first().click();

        const panel = page.locator('.config-panel', { has: page.locator('.config-panel-title', { hasText: 'Privacy' }) }).first();
        await expect(panel).toContainText('separate count');
        await expect(panel).toContainText('Your own install only counts when you turn it on');
        await expect(panel).toContainText('screen replays');
        await expect(panel.locator('input[type="checkbox"]').first()).toBeDisabled();
        await expect(panel.locator('input[type="checkbox"]').nth(1)).toBeDisabled();
    });

    test('a locked panel and a refused request report demo:refused, with no input', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="status"]').first().click();
        await page.locator('.demo-lock-chip').first().click();
        await expect.poll(async () => (await named(page, 'demo:refused')).length).toBe(1);
        expect((await named(page, 'demo:refused'))[0].props).toEqual({ action: 'locked-panel', mode: 'demo' });

        // A request the demo turns away answers with its own sentence; the
        // route is what is counted, without a query string and with whatever
        // follows the area collapsed to :id.
        const answered = await page.evaluate(async () => {
            const res = await fetch('/api/push/test?secret=abc', { method: 'POST' });
            return res.status;
        });
        expect(answered).toBe(403);
        await expect.poll(async () => (await named(page, 'demo:refused')).length).toBe(2);
        expect((await named(page, 'demo:refused'))[1].props).toEqual({ action: '/api/push/:id', mode: 'demo' });
    });

    test('Install in the demo bar reports demo:cta', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);
        await page.locator('.demo-bar-install').click();
        await expect.poll(async () => (await named(page, 'demo:cta')).length).toBe(1);
        expect((await named(page, 'demo:cta'))[0].props).toEqual({ target: 'install', mode: 'demo' });
    });

    test('the page after a reset reports demo:reset-seen', async ({ page, demoServer }) => {
        await openDemo(page, demoServer, { resetNote: true });
        await expect.poll(async () => (await named(page, 'demo:reset-seen')).length).toBe(1);
    });

    test('every event says demo, no snapshot goes out, and leaving reports the depth in bands', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);
        // Two real moves: the Config view, then the Inbox.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.locator('#page-nav-inbox-btn').click();
        await expect.poll(async () => (await named(page, 'view:inbox')).length).toBe(1);

        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await expect.poll(async () => (await named(page, 'demo:session-depth')).length).toBe(1);

        const calls = await umamiCalls(page);
        expect(calls.length).toBeGreaterThan(2);
        for (const call of calls) {
            expect(call.props?.mode, `${call.name} carries mode`).toBe('demo');
        }
        const names = calls.map((c) => c.name);
        expect(names.filter((n) => n.endsWith('-snapshot'))).toEqual([]);

        const depth = (await named(page, 'demo:session-depth'))[0].props;
        expect(depth.views).toMatch(/^(0|1|2|5|10|25|50|50\+)$/);
        expect(depth.actions).toMatch(/^(0|1|2|5|10|25|50|50\+)$/);
        expect(depth.views).not.toBe('0');

        // A second pagehide of the same visit does not count it twice.
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await page.waitForTimeout(300);
        expect((await named(page, 'demo:session-depth')).length).toBe(1);
    });

    test('a query or a hash parameter that does reach the address is cut before a pageview is sent', async ({ page, demoServer }) => {
        // The app keeps typed text out of the address in the demo (below), so
        // this is the second layer: an address that carries it anyway (a pasted
        // link, a future view) still leaves without it.
        await openDemo(page, demoServer);
        await page.evaluate(() => history.replaceState(null, '', '/?ib_q=tophemlig#inbox'));
        await page.evaluate(() => history.replaceState(null, '', '/#bookmarks?q=tophemlig&health=broken'));

        const sent = await page.evaluate(() => window.__sent || []);
        const urls = sent.map((p) => p.url);
        expect(urls.length).toBeGreaterThan(1);
        expect(urls.some((u) => u.endsWith('#inbox'))).toBe(true);
        expect(urls.some((u) => u.endsWith('#bookmarks'))).toBe(true);
        for (const url of urls) {
            expect(url, 'a sent address').not.toContain('?');
            expect(url, 'a sent address').not.toContain('tophemlig');
            expect(url, 'a sent address').not.toContain('ib_q');
        }
    });

    /*
     * The recorder reads the page address and has no hook to clean it, so in the
     * demo typed text is kept out of the address at the source. Both places that
     * wrote it: the Inbox search and the bookmark list's search (Health's home).
     */
    async function typeInInbox(page) {
        await page.locator('#page-nav-inbox-btn').click();
        const box = page.locator('.inbox-search-input');
        await expect(box).toBeVisible();
        await box.fill('tophemlig');
    }
    async function typeInBookmarks(page) {
        await markConfigSettingPromosSeen(page);
        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await page.waitForSelector('#config-bm-list', { timeout: 15_000 });
        await page.fill('#config-bm-search', 'tophemlig');
    }

    test('in the demo, typed text stays out of the address', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);
        await typeInInbox(page);
        // Give the view time to write its address, then look.
        await expect(page.locator('.inbox-search-input')).toHaveValue('tophemlig');
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => location.href)).not.toContain('tophemlig');
        expect(await page.evaluate(() => location.href)).not.toContain('ib_q');

        await typeInBookmarks(page);
        await expect(page.locator('#config-bm-search')).toHaveValue('tophemlig');
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => location.href)).not.toContain('tophemlig');
    });

    test('control: on an ordinary install the same searches are in the address', async ({ page, normalServer }) => {
        await markWhatsNewSeen(page);
        await page.goto(`${normalServer.baseURL}/`);
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });

        await typeInInbox(page);
        await expect.poll(() => page.evaluate(() => location.search), { timeout: 10_000 }).toContain('ib_q=tophemlig');

        await typeInBookmarks(page);
        await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toContain('q=tophemlig');
    });

    /** Every control in the Privacy & sync tab's panels, and whether the panel is locked. */
    const privacyTabState = (page) => page.evaluate(() => [...document.querySelectorAll('.config-panel')].map((panel) => ({
        title: panel.querySelector('.config-panel-title')?.firstChild?.textContent?.trim() || '',
        chips: panel.querySelectorAll('.demo-lock-chip').length,
        controls: [...panel.querySelectorAll('input, select, textarea, button')]
            .filter((el) => !el.classList.contains('demo-lock-chip'))
            .map((el) => ({ tag: el.tagName, off: el.disabled || !!el.closest('fieldset:disabled') })),
    })));

    test('in the demo, every panel of Privacy & sync is locked, with a chip', async ({ page, demoServer }) => {
        await openDemo(page, demoServer);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').first().click();
        await expect(page.locator('.config-panel-title', { hasText: 'Onboarding' })).toBeVisible();

        const panels = await privacyTabState(page);
        // Onboarding, Sync & feedback and Privacy: the whole tab.
        expect(panels.map((p) => p.title)).toEqual(expect.arrayContaining(['Onboarding', 'Sync & feedback', 'Privacy']));
        expect(panels.length).toBeGreaterThanOrEqual(3);
        for (const panel of panels) {
            expect(panel.chips, `${panel.title} has a lock chip`).toBe(1);
            expect(panel.controls.length, `${panel.title} has controls`).toBeGreaterThan(0);
            expect(panel.controls.filter((c) => !c.off), `${panel.title}: controls still enabled`).toEqual([]);
        }
        // The chip explains this tab, not the website checks.
        await page.locator('.demo-lock-chip').first().click();
        await expect(page.locator('#demo-lock-popover-privacy')).toContainText('stay as they are in the demo');
    });

    test('control: on an ordinary install Privacy & sync is not locked', async ({ page, normalServer }) => {
        await markWhatsNewSeen(page);
        await page.goto(`${normalServer.baseURL}/`);
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').first().click();
        await expect(page.locator('.config-panel-title', { hasText: 'Onboarding' })).toBeVisible();
        const panels = await privacyTabState(page);
        expect(panels.length).toBeGreaterThanOrEqual(3);
        expect(panels.every((p) => p.chips === 0)).toBe(true);
        expect(panels.some((p) => p.controls.some((c) => !c.off))).toBe(true);
    });
});
