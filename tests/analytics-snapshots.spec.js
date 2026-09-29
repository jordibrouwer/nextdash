// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * What the two snapshot events are allowed to contain.
 *
 * Umami takes at most 50 properties per event and drops the rest without a
 * word, so a payload that outgrows that is a payload with holes nobody would
 * notice for months. And the promise in Config → Behavior → Privacy is
 * narrower than the limit: booleans and small enums, numbers rounded into
 * buckets, never a hostname, a path or anything else free-form.
 *
 * Both are asserted here on the real payloads rather than read off the source,
 * because the rule that matters is what leaves the browser.
 */

const TRACKER = '**/stats.nextdash.cc/**';

/** Stand in for the tracker: same URL, so the load event fires and the queue flushes. */
async function stubTracker(page) {
    await page.route(TRACKER, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.__events = window.__events || []; window.umami = { track: (n, p) => window.__events.push([n, p]) };',
    }));
}

async function loadWithAnalyticsOn(page, extra = {}) {
    await stubTracker(page);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.settings != null, null, { timeout: 15_000 });
    await page.evaluate(async (extra) => {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        Object.assign(settings, extra);
        settings.analyticsOptIn = true;
        const write = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await write('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
    }, extra);
    // The tracker is emitted server-side, so only a fresh page carries it.
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // Waited for, not slept through. Six hundred milliseconds was long enough
    // until it was not: on CI both snapshots arrived after it and every test
    // here read an empty array -- which fails as "the events are wrong" when
    // what happened is that they had not happened yet. The tests that use
    // this loader all want every snapshot, so the loader waits for all five.
    await expect.poll(async () => page.evaluate(() =>
        (window.__events || []).filter(([name]) => name.endsWith('-snapshot')).length),
    { timeout: 20_000 }).toBe(5);
}

const snapshots = (page) => page.evaluate(() =>
    (window.__events || []).filter(([name]) => name.endsWith('-snapshot')));

test.describe('the analytics snapshots', () => {
    test('both fire once, and stay inside what Umami accepts', async ({ page }) => {
        await loadWithAnalyticsOn(page);
        const events = await snapshots(page);

        expect(events.map(([name]) => name).sort()).toEqual([
            'containers-snapshot', 'content-snapshot', 'settings-snapshot', 'views-snapshot', 'widgets-snapshot']);
        for (const [name, props] of events) {
            expect(Object.keys(props).length, `${name} property count`).toBeLessThanOrEqual(50);
            // Every event carries the release, or a default that changed
            // between versions reads as a drift rather than the switch it was.
            expect(props.appVersion, `${name} appVersion`).toBeTruthy();
            // Nothing was cut: the builder says so when it has to truncate.
            expect(props.truncated, `${name} truncated`).toBeUndefined();
        }
    });

    test('every value is a yes/no, a small enum, or a bucket', async ({ page }) => {
        await loadWithAnalyticsOn(page);
        const events = await snapshots(page);

        for (const [name, props] of events) {
            for (const [key, value] of Object.entries(props)) {
                const where = `${name}.${key}`;
                expect(typeof value, where).toMatch(/boolean|string/);
                if (typeof value === 'string') {
                    expect(value.length, `${where} length`).toBeLessThanOrEqual(40);
                    // A hostname, a path, an address or a sentence would all be
                    // free-form — the one thing this payload may never carry.
                    expect(value, where).not.toMatch(/https?:|\/\/|[@]|\s\s|[<>{}]/);
                }
            }
        }
    });

    test('counts go out as buckets, never as the number itself', async ({ page }) => {
        await loadWithAnalyticsOn(page);
        const [, content] = (await snapshots(page)).find(([name]) => name === 'content-snapshot');

        for (const [key, value] of Object.entries(content)) {
            if (key === 'appVersion') continue;
            expect(String(value), `content.${key}`).toMatch(/^(unset|\d+\+?)$/);
        }

        // Fed a distinctive library, the payload has to answer with a step —
        // the shape alone proves nothing, because a fixture whose count
        // happens to equal a step reads the same either way.
        expect(await page.evaluate(() => {
            const tag = document.querySelector('script[data-nextdash-analytics]');
            tag.setAttribute('data-content', JSON.stringify({
                bookmarks: 1274, pages: 7, categories: 33, tags: 61,
                finders: 4, collections: 2, monitored: 12, periodic: 240,
                inboxOpen: 41, inboxAdded: 613, inboxPromoted: 77, inboxDeleted: 158,
            }));
            window.nextdashTrackContent._sent = false;
            window.nextdashTrackContent();
            const event = (window.__events || []).reverse().find(([n]) => n === 'content-snapshot');
            return event[1];
        })).toMatchObject({
            bookmarks: '500+', pages: '10', categories: '40', tags: '50+',
            finders: '10', collections: '3', monitored: '30', periodic: '50+',
            inboxOpen: '100', inboxAdded: '200+', inboxPromoted: '50+', inboxDeleted: '50+',
        });
        expect(Object.keys(content)).toEqual(expect.arrayContaining([
            'bookmarks', 'pages', 'categories', 'tags', 'finders', 'collections',
            'monitored', 'periodic', 'inboxOpen', 'inboxAdded', 'inboxPromoted', 'inboxDeleted',
        ]));
    });

    test('a theme the user built is reported as "custom"', async ({ page }) => {
        await loadWithAnalyticsOn(page);

        // Its id is random and unique to this install, so sending it would be a
        // device id in all but name.
        expect(await page.evaluate(() => {
            window.nextdashTrackSettings._sent = false;
            window.nextdashTrackSettings({ theme: 'theme-lz9k2p-x7fa' });
            const event = (window.__events || []).reverse().find(([n]) => n === 'settings-snapshot');
            return event[1].theme;
        })).toBe('custom');
    });

    test('nothing is counted while analytics is off', async ({ page }) => {
        await stubTracker(page);
        await markWhatsNewSeen(page);
        await page.goto('/');
        // Switched off explicitly: the tests above leave it on in the shared
        // data directory, and "off by default" is not what this one is about.
        await page.waitForFunction(() => window.dashboardInstance?.settings != null, null, { timeout: 15_000 });
        await page.evaluate(async () => {
            const res = await fetch('/api/settings');
            const settings = await res.json();
            settings.analyticsOptIn = false;
            const write = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await write('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
        });
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });

        // The tracker is not emitted at all, so nothing is loaded and no
        // request leaves the machine — the promise in Config → Privacy. That
        // counting is also skipped server-side is proven in Go, where a nil
        // store makes any attempt to count panic
        // (analytics_content_test.go).
        expect(await page.evaluate(() =>
            document.querySelector('script[data-nextdash-analytics]'))).toBeNull();
        expect(await snapshots(page)).toEqual([]);
    });

    // Widgets, containers and the list views: what is there in buckets, how it
    // is set up in yes/no and short enums, and never a name -- a host address
    // or a hidden container set here must not come back out.
    test('the feature snapshots count and never name', async ({ page }) => {
        await loadWithAnalyticsOn(page, { dockerHostAddress: 'tower.lan', dockerHiddenContainers: ['secret-box'] });
        const byName = Object.fromEntries(await snapshots(page));

        expect(Object.keys(byName['widgets-snapshot'])).toEqual(expect.arrayContaining(['total', 'pages', 'health', 'containers']));
        expect(byName['containers-snapshot']).toMatchObject({ hostAddressSet: true, hidden: '1' });
        expect(Object.keys(byName['views-snapshot'])).toEqual(expect.arrayContaining(['healthChecked', 'inboxUnread', 'bmColumns']));
        const all = JSON.stringify([byName['widgets-snapshot'], byName['containers-snapshot'], byName['views-snapshot']]);
        expect(all).not.toContain('tower.lan');
        expect(all).not.toContain('secret-box');
    });

    // A container action is one `docker-action` event of fixed words: which
    // action, how it went and where from, with a bulk run's size as a bucket.
    // Never the container's name, its image or an address.
    test('a container action is counted and never named', async ({ page }) => {
        const { mockDocker } = require('./helpers/docker-mock');
        const state = await mockDocker(page);
        await loadWithAnalyticsOn(page);
        await page.goto('/#docker');
        await page.locator('[data-docker-group]').selectOption('none');
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        const actions = () => page.evaluate(() =>
            (window.__events || []).filter(([name]) => name === 'docker-action').map(([, props]) => props));

        // From the row keys: jellyfin is the second row by name.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('r');
        await expect.poll(actions).toEqual([{ action: 'restart', result: 'ok', via: 'key' }]);

        // From the selection bar: one event for the run, its size bucketed.
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
        await page.locator('[data-docker-bulk-action="restart"]').click();
        await expect.poll(() => state.calls.filter((c) => c.endsWith('/restart')).length).toBe(3);
        await expect.poll(async () => (await actions()).length).toBe(2);
        expect((await actions())[1]).toEqual({ action: 'restart', result: 'ok', via: 'bulk', count: '2' });

        const sent = JSON.stringify(await actions());
        for (const c of state.containers) {
            expect(sent).not.toContain(c.name);
            expect(sent).not.toContain(c.image);
        }
        expect(sent).not.toMatch(/\d{4}/);
    });
});
