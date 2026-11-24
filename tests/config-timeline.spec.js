// @ts-check
const { test, expect } = require('./fixtures');
const { waitForConfigReady } = require('./e2e-helpers');

/**
 * Config -> Timeline. The route is answered by the test, so the story is the
 * same on every machine: Sonarr went down a minute after its auto-update, and
 * a Glances incident has nothing before it.
 */
// Midday today, pinned in the page as well, so no minute of the day moves a row to another day.
const NOW = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();

function response() {
    const now = NOW;
    const at = (min) => now - min * 60_000;
    const update = {
        id: 'u1', at: at(61), source: 'update', kind: 'update', by: 'auto', from: '4.0.9', to: '4.0.10',
        subject: { type: 'container', name: 'sonarr' }, link: '#service?container=sonarr',
    };
    const down = {
        id: 'd1', at: at(60), end: at(46), durationMs: 14 * 60_000, source: 'health', kind: 'down', outage: true, count: 1,
        subject: { type: 'bookmark', name: 'Sonarr', key: 'sonarr.lan' }, link: '#service?url=https%3A%2F%2Fsonarr.lan%2F&page=1',
        detail: 'HTTP 502', causes: [{ eventId: 'u1', gapMs: 60_000, relation: 'linked-bookmark', confidence: 'sure' }],
    };
    const cpu = {
        id: 'g1', at: at(200), end: at(190), durationMs: 10 * 60_000, source: 'glances', kind: 'cpu', outage: true,
        subject: { type: 'glances', name: 'Tower', key: 'main' }, link: '#glances', detail: 'peak 94',
    };
    update.causeOf = ['d1'];
    return {
        generatedAt: now, from: now - 7 * 86400_000, to: now, events: [down, update, cpu], related: [],
        coverage: { docker: { ok: true }, update: { ok: true }, health: { ok: true }, check: { ok: false, reason: 'nothing-recorded' },
            glances: { ok: true }, unraid: { ok: false, reason: 'not-configured' }, links: { ok: true } },
    };
}

async function mockTimeline(page, seen) {
    await page.route('**/api/timeline*', async (route) => {
        seen.push(new URL(route.request().url()).searchParams);
        await route.fulfill({ json: response() });
    });
}

test.describe('Config → Timeline', () => {
    test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(NOW); });

    test('the section file and the data wait until the section is opened', async ({ page }) => {
        const files = [];
        const seen = [];
        page.on('request', (r) => { if (r.url().includes('dashboard-config-timeline')) files.push(r.url()); });
        await mockTimeline(page, seen);
        await page.goto('/#config/overview');
        await waitForConfigReady(page);
        expect(files).toEqual([]);
        expect(seen).toEqual([]);
        await page.locator('[data-config-section="timeline"]').click();
        await expect(page.locator('.tl-item')).toHaveCount(3);
        expect(files.length).toBe(1);
        expect(seen.length).toBe(1);
    });

    test('an outage shows its cause, and a row without one says so', async ({ page }) => {
        await mockTimeline(page, []);
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        const outage = page.locator('.tl-item', { hasText: 'Sonarr down' });
        await expect(outage.locator('.tl-cause')).toContainText('1 min after sonarr auto-updated 4.0.9 → 4.0.10');
        await expect(outage.locator('.tl-cause')).toContainText('Likely cause');
        await expect(outage.locator('.tl-cause a')).toHaveAttribute('href', '#service?container=sonarr');
        await expect(outage.locator('.tl-text')).toHaveAttribute('href', /^#service\?url=/);
        await expect(page.locator('.tl-item', { hasText: 'Tower' }).locator('.tl-cause--none')).toBeVisible();
        // The update is a row of its own as well, without a cause line.
        await expect(page.locator('.tl-item').filter({ has: page.locator('.tl-text', { hasText: /^sonarr auto-updated/ }) }).locator('.tl-cause')).toHaveCount(0);
    });

    test('the cause is a chain, and each day opens with a strip of its events', async ({ page }) => {
        await mockTimeline(page, []);
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        const outage = page.locator('.tl-item', { hasText: 'Sonarr down' });
        await expect(outage).toHaveClass(/tl-item--outage/);
        const chain = outage.locator('.tl-chain');
        await expect(chain).toHaveClass(/tl-c-update/);
        await expect(chain.locator('.tl-chain-line')).toHaveText('1 min');
        // The cause came first, so it is on the left.
        await expect(chain.locator('.tl-chain-node').first()).not.toHaveClass(/tl-chain-node--out/);
        // The update is what caused a shown outage, so it carries the ring.
        await expect(page.locator('.tl-item.tl-c-update')).toHaveClass(/tl-item--trigger/);
        // One tick per event of the day, an outage full height.
        const day = page.locator('.tl-day').first();
        await expect(day.locator('.tl-tick')).toHaveCount(await day.locator('.tl-item').count());
        await expect(day.locator('.tl-tick--out')).toHaveCount(await day.locator('.tl-item--outage').count());
        await expect(day.locator('.tl-day-sum')).toContainText(/outage/);
        // 11:00 for 14 minutes of a 24 hour day.
        const tick = day.locator('.tl-tick--out[style*="left:45.83%"]');
        await expect(tick).toHaveAttribute('style', /width:0\.97%/);
        await expect(page.locator('[data-tl-source="docker"]')).toHaveClass(/tl-c-docker/);
    });

    test('a cause that came after the outage sits on its right, and an ongoing outage runs up to now', async ({ page }) => {
        await page.route('**/api/timeline*', (route) => {
            const body = response();
            body.events[0].causes[0].gapMs = -60_000;
            body.events[0].ongoing = true;
            delete body.events[0].end;
            body.events[0].at = NOW - 120 * 60_000;
            return route.fulfill({ json: body });
        });
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        const nodes = page.locator('.tl-item', { hasText: 'Sonarr down' }).locator('.tl-chain-node');
        await expect(nodes.first()).toHaveClass(/tl-chain-node--out/);
        // 10:00 to now (12:00) is a twelfth of the day.
        await expect(page.locator('.tl-tick--out[style*="left:41.67%"]')).toHaveAttribute('style', /width:8\.33%/);
    });

    test('an update is not ringed for an outage that is not on screen', async ({ page }) => {
        await page.route('**/api/timeline*', (route) => {
            const body = response();
            body.events = body.events.filter((e) => e.id !== 'd1');
            return route.fulfill({ json: body });
        });
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        await expect(page.locator('.tl-item.tl-c-update')).not.toHaveClass(/tl-item--trigger/);
    });

    test('the filters ask the route, and are kept', async ({ page }) => {
        const seen = [];
        await mockTimeline(page, seen);
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        await expect(page.locator('.tl-item')).toHaveCount(3);

        await page.getByLabel('Only outages').check();
        await expect.poll(() => seen.at(-1)?.get('only')).toBe('outages');
        await page.locator('[data-tl-source="glances"]').click();
        await expect.poll(() => seen.at(-1)?.get('sources')).not.toContain('glances');
        await page.locator('.tl-days').selectOption('30');
        await expect.poll(() => seen.at(-1)?.get('days')).toBe('30');

        await page.reload();
        await waitForConfigReady(page);
        await expect(page.getByLabel('Only outages')).toBeChecked();
        await expect(page.locator('[data-tl-source="glances"]')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.tl-days')).toHaveValue('30');
    });

    test('a failed load offers to try again', async ({ page }) => {
        let fail = true;
        await page.route('**/api/timeline*', (route) => (fail ? route.fulfill({ status: 500, body: '{}' }) : route.fulfill({ json: response() })));
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        await expect(page.getByText("Couldn't load the timeline.")).toBeVisible();
        fail = false;
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('.tl-item')).toHaveCount(3);
    });

    test('a filter that hides everything can be undone', async ({ page }) => {
        await page.route('**/api/timeline*', (route) => {
            const only = new URL(route.request().url()).searchParams.get('only');
            const body = response();
            if (only) body.events = [];
            return route.fulfill({ json: body });
        });
        await page.goto('/#config/timeline');
        await waitForConfigReady(page);
        await page.getByLabel('With a cause').check();
        await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
        await page.getByRole('button', { name: 'Show all' }).click();
        await expect(page.locator('.tl-item')).toHaveCount(3);
    });
});
