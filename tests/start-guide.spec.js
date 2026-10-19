// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The start guide: what a fresh install opens on.
 *
 * The reader first sees the dashboard with its example links. A bar slides in
 * at the bottom, "What do you want?", and opens a modal in the middle with the
 * choices, the language, the weather and the first steps. It stays on the
 * dashboard of page 1 until every step is done or the reader closes it for
 * good, and it holds the corner while it is there.
 */

async function freshInstall(page, request, { settings = {} } = {}) {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    expect((await request.post('/api/settings', {
        data: {
            onboardingCompleted: false,
            discoveryCardDone: true,
            quickStart: { baselineBookmarks: -1, baselineTagged: -1, templatePicked: '' },
            ...settings,
        },
        headers,
    })).ok()).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const bar = (page) => page.locator('[data-start-guide-bar]');
const modal = (page) => page.locator('[data-start-guide-modal]');

async function openModal(page) {
    await expect(bar(page)).toBeVisible({ timeout: 10_000 });
    await bar(page).locator('[data-start-guide-open]').click();
    await expect(modal(page)).toBeVisible();
}

const stored = (page) => page.evaluate(async () => (await (await fetch('/api/settings')).json()));

test.describe('a fresh install', () => {
    test('shows the dashboard first, then a bar, never the old cards', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect(modal(page)).toHaveCount(0);
        await expect(page.locator('.first-start-card')).toHaveCount(0);
        await expect(page.locator('.quickstart-checklist')).toHaveCount(0);
        await expect(bar(page)).toContainText(/quick start/i);
        await expect(bar(page)).toContainText(/0 of \d+/);
    });

    test('the bar opens a modal in the middle, and Esc, a click outside and Close for now fold it back', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await expect(modal(page)).toHaveAttribute('role', 'dialog');
        await expect(modal(page)).toHaveAttribute('aria-modal', 'true');
        const box = await modal(page).boundingBox();
        expect(Math.abs(box.x + box.width / 2 - 700)).toBeLessThan(30);

        await page.keyboard.press('Escape');
        await expect(modal(page)).toHaveCount(0);
        await expect(bar(page)).toBeVisible();

        await bar(page).locator('[data-start-guide-open]').click();
        await expect(modal(page)).toBeVisible();
        await page.mouse.click(8, 8);
        await expect(modal(page)).toHaveCount(0);

        await bar(page).locator('[data-start-guide-open]').click();
        await modal(page).locator('[data-sg-minimise]').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(bar(page)).toBeVisible();
    });

    test('the modal never opens by itself, also after a reload', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect(modal(page)).toHaveCount(0);
    });

    test('Keep the examples folds the modal back to the bar and records the answer', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-keep]').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(bar(page)).toBeVisible();
        await expect.poll(async () => (await stored(page)).quickStart.templatePicked).toBe('keep');
        expect((await stored(page)).onboardingCompleted).toBe(false);
    });

    test('Start empty asks first, then clears the examples and folds back', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-empty]').click();
        // Nothing is removed by the first click.
        await expect(modal(page)).toBeVisible();
        expect(await page.evaluate(async () => (await (await fetch('/api/bookmarks?page=1')).json()).length)).toBeGreaterThan(0);
        await modal(page).locator('[data-sg-empty-confirm]').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(bar(page)).toBeVisible();
        expect(await page.evaluate(async () => (await (await fetch('/api/bookmarks?page=1')).json()).length)).toBe(0);
        await expect.poll(async () => (await stored(page)).quickStart.templatePicked).toBe('empty');
    });

    test('the theme studio link closes the modal and opens the studio', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-studio]').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 10_000 });
        // The studio hides the corner cards while it is open; the bar is only waiting.
        await expect(bar(page)).toHaveCount(1);
    });
});

test.describe('where the guide stands', () => {
    test('it is gone in config and on other pages, and back on the dashboard of page 1', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => { location.hash = '#config/overview'; });
        await expect(bar(page)).toBeHidden();
        await page.evaluate(() => { location.hash = '#2'; });
        await expect(bar(page)).toBeHidden();
        await page.evaluate(() => { location.hash = '#1'; });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
    });

    test('no other corner card while it is there, in either state', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        expect(await page.evaluate(() => window.NoticeCard.cornerIsFree('x-card'))).toBe(false);
        await bar(page).locator('[data-start-guide-open]').click();
        expect(await page.evaluate(() => window.NoticeCard.cornerIsFree('x-card'))).toBe(false);
    });

    test('an install that finished its first run never sees it', async ({ page, request }) => {
        await freshInstall(page, request, { settings: { onboardingCompleted: true } });
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();
        // Must not appear: give a late render the time it would take to show.
        await page.waitForTimeout(2500);
        await expect(bar(page)).toHaveCount(0);
    });

    test('the corner cards wait fifteen minutes after the guide is finished', async ({ page, request }) => {
        await freshInstall(page, request, { settings: { onboardingCompleted: true } });
        const free = (completedAt) => page.evaluate((at) => {
            window.dashboardInstance.settings.quickStart = { ...(window.dashboardInstance.settings.quickStart || {}), completedAt: at };
            return window.NoticeCard.cornerIsFree('x-card');
        }, completedAt);
        const now = Math.floor(Date.now() / 1000);
        expect(await free(now - 60)).toBe(false);
        expect(await free(now - 16 * 60)).toBe(true);
        expect(await free(0)).toBe(true);
    });
});

test.describe('closing', () => {
    test('the cross on the bar asks, and closing for good ends the onboarding', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await bar(page).locator('[data-start-guide-close]').click();
        // Asked, not done.
        await expect(bar(page)).toBeVisible();
        await bar(page).locator('[data-sg-confirm-close]').click();
        await expect(bar(page)).toHaveCount(0);
        await expect.poll(async () => (await stored(page)).onboardingCompleted).toBe(true);
        expect((await stored(page)).quickStart.completedAt).toBeGreaterThan(0);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await page.waitForTimeout(2500);
        await expect(bar(page)).toHaveCount(0);
    });

    test('a step taken is kept, and when every step is done the bar says so and waits for a click', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const ids = await modal(page).evaluate((el) => [...el.querySelectorAll('[data-sg-step]')].map((s) => s.getAttribute('data-sg-step')));
        expect(ids.length).toBeGreaterThanOrEqual(8);
        // Tick them off the way a reader without the measuring would.
        await page.evaluate((all) => window.dashboardInstance.quickStart?.guide?.markSteps?.(all), ids);
        await expect.poll(async () => (await stored(page)).quickStart.stepsDone.length).toBe(ids.length);
        await expect(bar(page)).toContainText(/all set/i);
        // Still waiting: nothing closes by itself.
        await expect(bar(page)).toBeVisible();
        expect((await stored(page)).onboardingCompleted).toBe(false);
        // The modal is open over the bar: its own footer says so too.
        await expect(modal(page).locator('[data-sg-all-set]')).toBeVisible();
        await modal(page).locator('[data-sg-all-set]').click();
        await expect(bar(page)).toHaveCount(0);
        await expect.poll(async () => (await stored(page)).onboardingCompleted).toBe(true);
    });
});

test.describe('inside the modal', () => {
    test('shows three steps and the rest behind Show more, with the tour first', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const visible = modal(page).locator('[data-sg-step]:visible');
        await expect(visible).toHaveCount(3);
        await expect(visible.first()).toHaveAttribute('data-sg-step', 'tour');
        await modal(page).locator('[data-sg-more]').click();
        expect(await modal(page).locator('[data-sg-step]:visible').count()).toBeGreaterThanOrEqual(8);
    });

    test('a step that leads to config closes the modal and goes there', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="widget"] button').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(page).toHaveURL(/#config\/widgets/);
        await page.evaluate(() => { location.hash = '#1'; });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await stored(page)).quickStart.stepsDone).toContain('widget');
    });

    test('the weather: a city and a unit are saved as the weather settings', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-city]').fill('Utrecht');
        await modal(page).locator('[data-sg-unit="fahrenheit"]').click();
        await modal(page).locator('[data-sg-city]').press('Enter');
        await expect.poll(async () => (await stored(page)).weatherLocation).toBe('Utrecht');
        const s = await stored(page);
        expect(s.weatherUnit).toBe('fahrenheit');
        expect(s.weatherSource).toBe('manual');
        // Typing does not fold the modal back.
        await expect(modal(page)).toBeVisible();
    });

    test('changing the language changes the dashboard and the guide at once, without a reload', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const before = await modal(page).locator('[data-sg-title]').innerText();
        // A string of the dashboard itself, outside the guide.
        const header = () => page.locator('#search-button, .header-top').first().innerText();
        const headerBefore = await header();
        await page.evaluate(() => { window.__marker = 'same page'; });
        await modal(page).locator('[data-sg-language]').selectOption('nl');
        await expect.poll(async () => (await stored(page)).language).toBe('nl');
        await expect(modal(page).locator('[data-sg-title]')).not.toHaveText(before);
        expect(await page.evaluate(() => window.__marker)).toBe('same page');
        await expect(bar(page)).toContainText(/snel starten/i);
        await expect.poll(header).not.toBe(headerBefore);
        await expect(modal(page)).toBeVisible();
    });
});

test.describe('finding the bar again', () => {
    test('when the modal folds back, the bar says where it went', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await page.keyboard.press('Escape');
        await expect(bar(page)).toHaveClass(/is-landed/);
    });

    test('the bar pulses on every load until it has been opened once', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect(bar(page)).toHaveClass(/is-pulsing/);
        // Reloading does not stop it: nobody has looked yet.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect(bar(page)).toHaveClass(/is-pulsing/);
        await openModal(page);
        await page.keyboard.press('Escape');
        await expect(bar(page)).not.toHaveClass(/is-pulsing/);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect(bar(page)).not.toHaveClass(/is-pulsing/);
    });

    test('with reduced motion the bar does not animate', async ({ page, request }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        const names = await bar(page).evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el.querySelector('.sg-bar-dot')).animationName]);
        expect(names).toEqual(['none', 'none']);
    });
});

test.describe('review findings', () => {
    test('a link in the modal acts once, also after Show more', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await page.evaluate(() => { window.__opens = 0; window.open = () => { window.__opens += 1; return null; }; });
        await modal(page).locator('[data-sg-manual]').click();
        expect(await page.evaluate(() => window.__opens)).toBe(1);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-manual]').click();
        expect(await page.evaluate(() => window.__opens)).toBe(2);
    });

    test('focus stays in the modal after Show more and after cancelling Start empty', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        expect(await page.evaluate(() => document.querySelector('[data-start-guide-modal]').contains(document.activeElement))).toBe(true);
        await modal(page).locator('[data-sg-empty]').click();
        await modal(page).locator('[data-sg-empty-cancel]').click();
        expect(await page.evaluate(() => document.querySelector('[data-start-guide-modal]').contains(document.activeElement))).toBe(true);
        // Tab from wherever focus is must stay inside too.
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.querySelector('[data-start-guide-modal]').contains(document.activeElement))).toBe(true);
    });

    test('an answered choice is not offered again, after reopening or a reload', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-keep]').click();
        await bar(page).locator('[data-start-guide-open]').click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('[data-sg-keep]')).toHaveCount(0);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await openModal(page);
        await expect(modal(page).locator('[data-sg-keep]')).toHaveCount(0);
        await expect(modal(page).locator('[data-sg-empty]')).toHaveCount(0);
    });

    test('Start empty still finishes when the page reload fails after the server has cleared it', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await page.evaluate(() => { window.dashboardInstance.loadPageBookmarks = async () => { throw new Error('boom'); }; });
        await modal(page).locator('[data-sg-empty]').click();
        await modal(page).locator('[data-sg-empty-confirm]').click();
        await expect(modal(page)).toHaveCount(0);
        await expect.poll(async () => (await stored(page)).quickStart.templatePicked).toBe('empty');
    });

    test('the landing glow and the pulse ring really run', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => bar(page).evaluate((el) => getComputedStyle(el).animationName)).toContain('sg-ring');
        await openModal(page);
        await page.keyboard.press('Escape');
        await expect.poll(() => bar(page).evaluate((el) => getComputedStyle(el).animationName)).toContain('sg-land');
    });

    test('the bar steps aside for an essential notice, also while it animates', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => {
            const card = document.createElement('div');
            card.className = 'quickstart-card notice-card show';
            card.id = 'fake-essential';
            document.body.appendChild(card);
        });
        await expect(bar(page)).toBeHidden();
    });

    test('a quick run of language changes ends on the last one', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await page.evaluate(() => {
            const select = document.querySelector('[data-sg-language]');
            select.value = 'de'; select.dispatchEvent(new Event('change', { bubbles: true }));
            const again = document.querySelector('[data-sg-language]');
            again.value = 'nl'; again.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect.poll(async () => (await stored(page)).language).toBe('nl');
        await expect(bar(page)).toContainText(/snel starten/i);
        await expect(modal(page).locator('[data-sg-language]')).toHaveValue('nl');
    });

    test('without a choice to make the modal does not ask "what do you want?"', async ({ page, request }) => {
        await freshInstall(page, request);
        await page.evaluate(async () => {
            await nextDashFetch('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 1, bookmark: { name: 'Mine', url: 'https://example.com/', category: 'search', tags: [] } }),
            });
        });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await openModal(page);
        await expect(modal(page).locator('[data-sg-title]')).toHaveText(/quick start/i);
        await expect(modal(page)).not.toContainText(/clear them and add your own/i);
    });

    test('the block-move intro and other unprompted tips wait out the quiet period too', async ({ page, request }) => {
        await freshInstall(page, request, { settings: { onboardingCompleted: true } });
        const quiet = (completedAt) => page.evaluate((at) => {
            window.dashboardInstance.settings.quickStart = { ...(window.dashboardInstance.settings.quickStart || {}), completedAt: at };
            return window.DashboardBlockMoveIntro?.isQuiet?.() ?? null;
        }, completedAt);
        const now = Math.floor(Date.now() / 1000);
        expect(await quiet(now - 60)).toBe(true);
        expect(await quiet(now - 16 * 60)).toBe(false);
    });
});

test.describe('the way back', () => {
    test('Connect your containers opens the Containers view, and Esc comes back to the dashboard', async ({ page, request }) => {
        await mockDocker(page);
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="containers"] button').click();
        await expect(modal(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 15_000 }).toBe('docker');
        await expect(bar(page)).toBeHidden();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 15_000 }).toBe('bookmarks');
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await stored(page)).quickStart.stepsDone).toContain('containers');
    });

    test('the key 1 brings you back from config, and the modal says so from the start', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const hint = modal(page).locator('[data-sg-back-hint]');
        await expect(hint).toBeVisible();
        await expect(hint.locator('kbd')).toHaveText(['Esc', '1']);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="overview"] button').click();
        await expect(page).toHaveURL(/#config\/overview/);
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 15_000 }).toBe('bookmarks');
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
    });
});
