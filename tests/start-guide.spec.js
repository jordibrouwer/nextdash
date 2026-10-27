// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen } = require('./e2e-helpers');

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
    await settled(page);
}

/** The modal grows out of the bar; measure it once it has stopped. */
const settled = (page) => page.waitForFunction(() =>
    !document.querySelector('[data-start-guide-modal]')?.getAnimations().length);

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

    test('the modal grows out of the bar and folds back into it', async ({ page, request }) => {
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        // The window's own centre and the bar's, to tell where the modal is drawn from.
        const spots = await page.evaluate(() => {
            const b = document.querySelector('[data-start-guide-bar]').getBoundingClientRect();
            return { bar: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, mid: { x: innerWidth / 2, y: innerHeight / 2 } };
        });
        const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        // Sampled on every frame from the click: the first one is at the bar, the last in the middle.
        const frames = await page.evaluate(async () => {
            const seen = [];
            const watch = () => {
                const m = document.querySelector('[data-start-guide-modal]');
                if (m) { const r = m.getBoundingClientRect(); seen.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }
            };
            document.querySelector('[data-start-guide-open]').click();
            for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); watch(); }
            return seen;
        });
        expect(frames.length).toBeGreaterThan(5);
        expect(distance(frames[0], spots.bar)).toBeLessThan(distance(frames[0], spots.mid));
        expect(distance(frames[frames.length - 1], spots.mid)).toBeLessThan(10);

        // Folding: the overlay is still drawn, moving, after the dialog is gone from the page.
        const folding = await page.evaluate(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise((r) => requestAnimationFrame(r));
            return {
                drawn: Boolean(document.querySelector('.start-guide-overlay')),
                dialog: document.querySelectorAll('[data-start-guide-modal]').length,
            };
        });
        expect(folding.drawn).toBe(true);
        expect(folding.dialog).toBe(0);
        await expect(page.locator('.start-guide-overlay')).toHaveCount(0);
    });

    test('a data folder started from scratch opens it again, in a browser that found the bar before', async ({ page, request }) => {
        await page.addInitScript(() => {
            window.__e2eStartGuideAutoOpenMs = 1500;
            // What an earlier install left behind in this browser.
            if (!localStorage.getItem('nextdash:start-guide-found')) localStorage.setItem('nextdash:start-guide-found', '1');
        });
        await freshInstall(page, request);
        await expect(modal(page)).toBeVisible({ timeout: 10_000 });
    });

    test('the modal opens by itself once, three seconds after the bar, and not again after a reload', async ({ page, request }) => {
        await page.addInitScript(() => { window.__e2eStartGuideAutoOpenMs = 3000; });
        await freshInstall(page, request);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        const shown = Date.now();
        await expect(modal(page)).toBeVisible({ timeout: 8_000 });
        expect(Date.now() - shown).toBeGreaterThan(1_500);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toHaveCount(0);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        // Negative check: a late auto-open must not come, so give the three seconds time to pass.
        await page.waitForTimeout(4_000);
        await expect(modal(page)).toHaveCount(0);
    });

    test('Keep the examples records the answer and the guide stays for what comes next', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-keep]').click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('[data-sg-keep]')).toHaveCount(0);
        await expect.poll(async () => (await stored(page)).quickStart.templatePicked).toBe('keep');
        expect((await stored(page)).onboardingCompleted).toBe(false);
    });

    test('Start empty asks first, then clears the examples and the guide stays', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-empty]').click();
        // Nothing is removed by the first click.
        await expect(modal(page)).toBeVisible();
        expect(await page.evaluate(async () => (await (await fetch('/api/bookmarks?page=1')).json()).length)).toBeGreaterThan(0);
        await modal(page).locator('[data-sg-empty-confirm]').click();
        await expect(modal(page).locator('[data-sg-empty]')).toHaveCount(0);
        await expect(modal(page)).toBeVisible();
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
    test('it is gone in config, stays on the other pages, and is back on the dashboard', async ({ page, request }) => {
        await freshInstall(page, request);
        // A second page to stand on, whatever the reset left behind.
        if ((await page.evaluate(() => window.dashboardInstance.pages.length)) < 2) {
            expect((await request.post('/api/pages', {
                data: [{ id: 1, name: 'main' }, { id: 2, name: 'second' }],
                headers: { 'X-NextDash-Token': WRITE_TOKEN },
            })).ok()).toBe(true);
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        }
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await page.evaluate(() => { location.hash = '#config/overview'; });
        await expect(bar(page)).toBeHidden();
        await page.evaluate(() => { location.hash = '#2'; });
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
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

    test('the corner cards wait ten seconds after the guide is finished', async ({ page, request }) => {
        await freshInstall(page, request, { settings: { onboardingCompleted: true } });
        const free = (completedAt) => page.evaluate((at) => {
            window.dashboardInstance.settings.quickStart = { ...(window.dashboardInstance.settings.quickStart || {}), completedAt: at };
            return window.NoticeCard.cornerIsFree('x-card');
        }, completedAt);
        const now = Math.floor(Date.now() / 1000);
        expect(await free(now - 3)).toBe(false);
        expect(await free(now - 20)).toBe(true);
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
        // A check that the bar does NOT come back: it slides in after a delay,
        // so a count taken at once would pass before it could appear.
        await page.waitForTimeout(2500);
        await expect(bar(page)).toHaveCount(0);
    });

    test('a step taken is kept, and when every step is done the bar says so and waits for a click', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const ids = await modal(page).evaluate((el) => [...el.querySelectorAll('[data-sg-step]')].map((s) => s.getAttribute('data-sg-step')));
        expect(ids.length).toBeGreaterThanOrEqual(7);
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
    test('on a wide screen the guide is two columns and still folds the steps after three', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const box = await modal(page).evaluate((el) => ({
            scroll: el.scrollHeight, client: el.clientHeight,
            left: el.querySelector('.sg-col').getBoundingClientRect().left,
            right: el.querySelectorAll('.sg-col')[1].getBoundingClientRect().left,
        }));
        expect(box.right).toBeGreaterThan(box.left + 200);
        expect(box.scroll).toBeLessThanOrEqual(box.client);
        await expect(modal(page).locator('[data-sg-step]:visible')).toHaveCount(3);
    });

    test('all the steps open as a grid under the two columns, and Show fewer folds them again', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        const steps = modal(page).locator('[data-sg-step]:visible');
        await expect(steps).toHaveCount(10);
        // A grid: the first two steps sit side by side, and the list is under the columns.
        const spots = await modal(page).evaluate((el) => {
            const [a, b] = [...el.querySelectorAll('[data-sg-step]')].slice(0, 2).map((n) => n.getBoundingClientRect());
            return { sameRow: Math.abs(a.top - b.top) < 4, apart: b.left - a.left,
                below: a.top > el.querySelector('.sg-cols').getBoundingClientRect().bottom - 2 };
        });
        expect(spots.sameRow).toBe(true);
        expect(spots.apart).toBeGreaterThan(150);
        expect(spots.below).toBe(true);
        await modal(page).locator('[data-sg-less]').click();
        await expect(steps).toHaveCount(3);
        await expect(modal(page).locator('[data-sg-more]')).toBeVisible();
    });

    test('shows three steps and the rest behind Show more, with the tour first', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const visible = modal(page).locator('[data-sg-step]:visible');
        await expect(visible).toHaveCount(3);
        await expect(visible.first()).toHaveAttribute('data-sg-step', 'tour');
        await modal(page).locator('[data-sg-more]').click();
        expect(await modal(page).locator('[data-sg-step]:visible').count()).toBeGreaterThanOrEqual(7);
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

    test('the cheat sheet is a step: it opens over the dashboard and the step ticks off', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="cheatsheet"] button').click();
        await expect(page.locator('.keyboard-cheat-sheet-modal')).toBeVisible();
        await expect.poll(async () => (await stored(page)).quickStart.stepsDone).toContain('cheatsheet');
    });

    test('the manual has its own block: why there is one, and a button to nextdash.cc/docs', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await expect(modal(page).locator('.sg-manual')).toContainText('overwhelming');
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
        await modal(page).getByRole('button', { name: /Open the manual/ }).click();
        expect(await page.evaluate(() => window.__opened)).toEqual(['https://nextdash.cc/docs/']);
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
        await modal(page).locator('[data-sg-minimise]').click();
        await expect(modal(page)).toHaveCount(0);
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
        await expect(modal(page).locator('[data-sg-empty]')).toHaveCount(0);
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
    test('Open the Bookmarks view opens it, and Esc comes back to the dashboard', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="bookmarks"] button').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(page).toHaveURL(/#bookmarks/);
        await expect(page.locator('#dashboard-layout.library-layout')).toBeVisible({ timeout: 15_000 });
        await expect(bar(page)).toBeHidden();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 15_000 }).toBe('bookmarks');
        await expect(page.locator('#dashboard-layout.library-layout')).toHaveCount(0);
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await stored(page)).quickStart.stepsDone).toContain('bookmarks');
    });

    test('there is no Containers step any more', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        await expect(modal(page).locator('[data-sg-step="containers"]')).toHaveCount(0);
        expect(await modal(page).locator('[data-sg-step]').count()).toBe(10);
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

test.describe('the steps', () => {
    test('come in the order a reader would take them', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        const ids = await modal(page).evaluate((el) => [...el.querySelectorAll('[data-sg-step]')].map((s) => s.getAttribute('data-sg-step')));
        // Find your way, look at your links and their tags, add to the page, watch it, then the settings.
        expect(ids).toEqual(['tour', 'bookmarks', 'tags', 'inbox', 'widget', 'checks', 'notifications', 'overview', 'cheatsheet', 'secondPage']);
    });

    test('Open the Inbox view opens it, and Esc comes back to the dashboard', async ({ page, request }) => {
        await freshInstall(page, request);
        await openModal(page);
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="inbox"] button').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(page).toHaveURL(/#inbox/);
        await expect(page.locator('#dashboard-layout.inbox-layout')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 15_000 }).toBe('inbox');
        // The first visit to the Inbox shows its tour: the first Esc closes that,
        // the next one leaves the view.
        if (await page.locator('#app-modal.show').count()) {
            await page.keyboard.press('Escape');
            await expect(page.locator('#app-modal.show')).toHaveCount(0);
        }
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 15_000 }).toBe('bookmarks');
        await expect(bar(page)).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => (await stored(page)).quickStart.stepsDone).toContain('inbox');
    });
});

test.describe('the tag step', () => {
    const cloud = (page) => page.locator('#tag-cloud-modal');

    test('with tags in the library it opens the real cloud', async ({ page, request }) => {
        await freshInstall(page, request);
        const has = await page.evaluate(() => window.DashboardTagCloud.libraryHasTags());
        test.skip(!has, 'the starter links carry no tags here');
        await openModal(page);
        await modal(page).locator('[data-sg-step="tags"] button').click();
        await expect(cloud(page)).toBeVisible();
        await expect(page.locator('[data-tag-cloud-demo]')).toHaveCount(0);
    });

    test('with no tags it shows an example cloud once, then goes to the Tags view', async ({ page, request }) => {
        await freshInstall(page, request);
        await page.evaluate(() => { window.DashboardTagCloud.libraryHasTags = () => false; });
        await openModal(page);
        await modal(page).locator('[data-sg-step="tags"] button').click();

        await expect(cloud(page)).toBeVisible();
        await expect(page.locator('[data-tag-cloud-demo]')).toBeVisible();
        expect(await cloud(page).locator('.tag-cloud-word').count()).toBeGreaterThanOrEqual(8);
        // The words are examples: picking one filters nothing.
        await cloud(page).locator('.tag-cloud-word').first().click();
        expect(await page.evaluate(() => window.dashboardInstance.hasActiveTagFilters?.() === true)).toBe(false);
        await expect(cloud(page)).toBeVisible();
        await expect.poll(async () => (await stored(page)).quickStart.tagDemoShown).toBe(true);

        // Closed, and asked for again: the example does not come back.
        await page.keyboard.press('Escape');
        await expect(cloud(page)).toBeHidden();
        await bar(page).locator('[data-start-guide-open]').click();
        await expect(modal(page)).toBeVisible();
        // Taken once, the step sits behind "Show more" with the others that are done.
        await modal(page).locator('[data-sg-more]').click();
        await modal(page).locator('[data-sg-step="tags"] button').click();
        await expect(page).toHaveURL(/#tags/);
        await expect(page.locator('[data-tag-cloud-demo]')).toHaveCount(0);
    });

    test('the example has a way into the Tags view', async ({ page, request }) => {
        await freshInstall(page, request);
        await page.evaluate(() => { window.DashboardTagCloud.libraryHasTags = () => false; });
        await openModal(page);
        await modal(page).locator('[data-sg-step="tags"] button').click();
        await page.locator('.tag-cloud-demo-view').click();
        await expect(page).toHaveURL(/#tags/);
        await expect(cloud(page)).toBeHidden();
    });
});
