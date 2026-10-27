// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * What the start guide tells Umami: that it opened and how, how it closed,
 * which step was taken and how it ended -- as fixed words and a band, so the
 * funnel can be read without a name, an address or a count leaving the browser.
 */

async function freshInstall(page, request) {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    expect((await request.post('/api/settings', {
        data: {
            onboardingCompleted: false,
            discoveryCardDone: true,
            quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: 'keep' },
        },
        headers,
    })).ok()).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page.locator('[data-start-guide-bar]')).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
        window.__tracks = [];
        window.nextdashTrack = (name, props) => window.__tracks.push({ name, props });
    });
}

const bar = (page) => page.locator('[data-start-guide-bar]');
const modal = (page) => page.locator('[data-start-guide-modal]');
const tracks = (page, prefix = 'start-guide:') => page.evaluate((p) =>
    (window.__tracks || []).filter((t) => t.name.startsWith(p)), prefix);

async function openModal(page) {
    await bar(page).locator('[data-start-guide-open]').click();
    await expect(modal(page)).toBeVisible();
}

test('opening from the bar and closing with Escape are two events, with the steps done as a band', async ({ page, request }) => {
    await freshInstall(page, request);
    await openModal(page);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    const seen = await tracks(page);
    expect(seen).toEqual([
        { name: 'start-guide:open', props: { via: 'bar', done: '0' } },
        { name: 'start-guide:close', props: { via: 'escape', done: '0' } },
    ]);
});

test('a step taken is named, and the close that follows says it was a step', async ({ page, request }) => {
    await freshInstall(page, request);
    await openModal(page);
    await modal(page).locator('[data-sg-more]').click();
    await modal(page).locator('[data-sg-step="cheatsheet"] button').click();
    const seen = await tracks(page);
    expect(seen.map((t) => t.name)).toEqual(['start-guide:open', 'start-guide:step', 'start-guide:close']);
    expect(seen[1].props).toEqual({ step: 'cheatsheet' });
    expect(seen[2].props.via).toBe('step');
});

test('Close for now, closing for good and finishing are told apart', async ({ page, request }) => {
    await freshInstall(page, request);
    await openModal(page);
    await modal(page).locator('[data-sg-minimise]').click();
    await expect(modal(page)).toHaveCount(0);
    expect((await tracks(page)).at(-1).props.via).toBe('minimise');

    await bar(page).locator('[data-start-guide-close]').click();
    await bar(page).locator('[data-sg-confirm-close]').click();
    const finish = (await tracks(page)).filter((t) => t.name === 'start-guide:finish');
    expect(finish).toEqual([{ name: 'start-guide:finish', props: { how: 'dismissed', done: '0' } }]);
});

test('finishing every step reports "all"', async ({ page, request }) => {
    await freshInstall(page, request);
    await page.evaluate(() => {
        const guide = window.dashboardInstance.quickStart?.guide;
        guide.markSteps(guide.steps().map((s) => s.id));
    });
    await expect(bar(page)).toContainText(/all set/i);
    await bar(page).locator('[data-sg-all-set]').click();
    const finish = (await tracks(page)).filter((t) => t.name === 'start-guide:finish');
    expect(finish).toHaveLength(1);
    expect(finish[0].props).toEqual({ how: 'all', done: '6+' });
});

test('the links out are named, and every value is a short fixed word', async ({ page, request }) => {
    await freshInstall(page, request);
    await openModal(page);
    await page.evaluate(() => { window.open = () => null; });
    await modal(page).locator('[data-sg-manual]').click();
    const links = (await tracks(page)).filter((t) => t.name === 'start-guide:link');
    expect(links).toEqual([{ name: 'start-guide:link', props: { to: 'manual' } }]);
    for (const event of await tracks(page)) {
        for (const value of Object.values(event.props)) {
            expect(String(value), `${event.name}`).toMatch(/^[a-z0-9+-]{1,12}$/);
        }
    }
});
