// @ts-check
/*
 * The looping videos (loop.webm) of four nextdash.cc feature pages: recents,
 * settings, tag-view, watch-feeds. 1440x900, Tarnished Brass dark, demo seed.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=1 \
 *     npx playwright test tests/site-loops-LD.spec.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    test,
    prepare,
    openDashboard,
    settle,
    DESKTOP,
} = require('./helpers/manual-shot-kit');
const { newsData, startNewsStub, watchSites, shiftFeedTimes } = require('./helpers/watch-news-mock');

test.skip(!process.env.MANUAL_SHOTS, 'loops run on purpose only');
test.use({
    viewport: DESKTOP,
    reducedMotion: 'no-preference',
    video: { mode: 'on', size: { width: 1440, height: 900 } },
});
test.setTimeout(120_000);

const OUT = process.env.SHOTS_OUT;

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** Settings changed in this test's copy of the data. */
const settingsTweak = (extra) => ({
    run(dir) {
        const file = path.join(dir, 'settings.json');
        writeJSON(file, { ...readJSON(file), showGridKeyLegend: false, ...extra });
    },
});

/** Human pace between two actions. */
const beat = (page, ms) => page.waitForTimeout(ms); // Pacing for the capture, not a condition: one action per second or two.

/**
 * Records `run` as a loop: the clip starts when `begin()` is called (after the
 * setup) and ends when `run` returns; then the video is cut.
 */
async function recordLoop(page, slug, setup, run) {
    const t0 = Date.now();
    await setup();
    // A pointer parked in a corner, nothing focused: the first frame is a quiet screen.
    await page.mouse.move(5, DESKTOP.height - 5);
    await page.evaluate(() => document.activeElement?.blur?.());
    const startAt = (Date.now() - t0) / 1000;
    await beat(page, 1_200);
    await run();
    await beat(page, 1_200);
    // Rest at the end until the loop is at least 9.6 s long.
    const short = 9.6 + 0.6 - ((Date.now() - t0) / 1000 - startAt);
    if (short > 0) await beat(page, short * 1000);
    const seconds = (Date.now() - t0) / 1000 - startAt;
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    const video = page.video();
    await page.close();
    const src = await video.path();
    fs.writeFileSync(path.join(dir, 'loop.json'), JSON.stringify({ startAt, seconds, video: src }));
    // The cut of trim-loop.sh, with a faster vp8 setting (the default one crawls on a busy machine).
    const dur = String(Math.min(13, Math.max(9, seconds - 0.6)));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(startAt + 0.4), '-t', dur, '-i', src,
        '-vf', 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0x0e1210',
        '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-an', path.join(dir, 'loop.webm')], { stdio: 'inherit' });
}

test('loop recents', async ({ page }) => {
    await recordLoop(page, 'recents', async () => {
        await prepare(page);
        await openDashboard(page);
    }, async () => {
        const sheet = page.locator('#app-modal.show .recent-bookmarks-modal');
        await page.keyboard.press('*');
        await sheet.waitFor();
        await sheet.getByText(/of \d+/).first().waitFor();
        await beat(page, 1_600);
        await page.keyboard.press('ArrowRight');
        await beat(page, 700);
        await page.keyboard.press('ArrowDown');
        await beat(page, 900);
        await page.keyboard.press(']');
        await sheet.getByText(/11.{1,3}20 of/).first().waitFor();
        await beat(page, 1_400);
        await page.keyboard.press('[');
        await sheet.getByText(/1.{1,3}10 of/).first().waitFor();
        await beat(page, 1_100);
        await page.keyboard.press('Escape');
        await page.locator('#app-modal.show').waitFor({ state: 'hidden' });
    });
});

test('loop settings', async ({ page }) => {
    await recordLoop(page, 'settings', async () => {
        await prepare(page);
        await openDashboard(page);
    }, async () => {
        await page.keyboard.press('Shift+S');
        await page.locator('.config-overview-tip').waitFor();
        await beat(page, 1_800);
        await page.keyboard.press('ControlOrMeta+Shift+K');
        const finder = page.locator('#app-modal.show .config-settings-jump-modal');
        await finder.waitFor();
        await finder.locator('input').first().click();
        await page.keyboard.type('hotkey', { delay: 110 });
        await page.locator('.config-settings-jump-result').first().waitFor();
        await beat(page, 1_300);
        await page.keyboard.press('Enter');
        await page.locator('[data-behavior-field="globalShortcuts"]').first().waitFor();
        await beat(page, 1_800);
        // Back to the dashboard: 1 leaves Config for the first page.
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('1');
        await page.waitForFunction(() => !window.location.hash.startsWith('#config'));
        await page.locator('#dashboard-layout .category').first().waitFor({ state: 'visible', timeout: 5_000 });
    });
});

test.describe('tag view', () => {
    test.use({ dataTweak: settingsTweak({}) });

    test('loop tag-view', async ({ page }) => {
        await recordLoop(page, 'tag-view', async () => {
            await prepare(page);
            await openDashboard(page);
        }, async () => {
            await page.keyboard.press('/');
            await page.locator('#tag-cloud-modal.is-open').waitFor();
            await beat(page, 1_500);
            // Arrow keys walk the cloud; the words are then stacked with Shift + Enter.
            await page.locator('#tag-cloud-modal .tag-cloud-word[data-tag="hardware"]').focus();
            await beat(page, 700);
            await page.keyboard.press('Shift+Enter');
            await beat(page, 1_000);
            await page.locator('#tag-cloud-modal .tag-cloud-word[data-tag="news"]').focus();
            await beat(page, 600);
            await page.keyboard.press('Shift+Enter');
            await beat(page, 800);
            await page.keyboard.press('Escape');
            const view = page.locator('#dashboard-layout .tag-view');
            await view.waitFor({ state: 'visible' });
            await view.locator('.tag-view-row').first().waitFor();
            await beat(page, 1_600);
            await page.locator('.tag-view [data-tag-view-mode]').click();
            await beat(page, 1_600);
            await page.locator('.tag-view [data-tag-view-mode]').click();
            await beat(page, 1_000);
            await page.keyboard.press('Escape');
            await page.locator('#dashboard-layout .tag-view').waitFor({ state: 'hidden' });
        });
    });
});

test.describe('watch feeds', () => {
    test.use({ dataTweak: { run(dir) { newsData(dir); settingsTweak({}).run(dir); } } });

    test('loop watch-feeds', async ({ page, server }) => {
        await recordLoop(page, 'watch-feeds', async () => {
            const stub = await startNewsStub();
            try {
                await watchSites(server, stub);
            } finally {
                await stub.close();
            }
            await prepare(page);
            await shiftFeedTimes(page);
            await openDashboard(page);
            // The News category up under the header, as its picture shows it.
            await page.evaluate(() => {
                const cat = document.querySelector('#dashboard-layout .category[data-category="news"], #category-title-news')?.closest('.category');
                window.scrollBy(0, (cat?.getBoundingClientRect().top ?? 0) - 120);
            });
            await page.waitForTimeout(1_000); // Pacing for the capture, not a condition: the page settles after the scroll.
        }, async () => {
            const link = page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: 'Northside Gazette' }).first();
            await link.hover();
            await page.locator('.bookmark-preview-card-news-page').first().waitFor();
            await beat(page, 1_800);
            await page.locator('[data-feed-news-page="1"]').click();
            await beat(page, 1_300);
            await page.locator('[data-feed-news-page="1"]').click();
            await beat(page, 1_300);
            await page.locator('[data-feed-news-action="read"]').click();
            await page.locator('[data-feed-news]').waitFor({ state: 'visible' });
            await beat(page, 1_800);
            await page.keyboard.press('j');
            await beat(page, 1_500);
            // Esc steps back from the article, then closes the window: stop as soon as it is gone.
            for (let i = 0; i < 3 && await page.locator('[data-feed-news]').isVisible(); i += 1) {
                await page.keyboard.press('Escape');
                await beat(page, 700);
            }
            await page.locator('[data-feed-news]').waitFor({ state: 'hidden' });
            await page.mouse.move(5, DESKTOP.height - 5);
        });
    });
});
