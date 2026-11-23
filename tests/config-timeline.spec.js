// @ts-check
const { test, expect } = require('./fixtures');
const { waitForConfigReady } = require('./e2e-helpers');

/**
 * Config -> Timeline. The route is answered by the test, so the story is the
 * same on every machine: Sonarr went down a minute after its auto-update, and
 * a Glances incident has nothing before it.
 */
function response() {
    const now = Date.now();
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
