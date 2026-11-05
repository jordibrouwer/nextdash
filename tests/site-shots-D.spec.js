// @ts-check
/*
 * The nextdash.cc feature-page pictures of letter D: the tag view, the tag
 * cloud and tag colours, Watch feeds, Statistics, the first-start guide and
 * tour, the Custom widget editor and importing a page template. Full frames,
 * 1440x900, in the kit's default look.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> PW_WORKERS=2 \
 *     npx playwright test tests/site-shots-D.spec.js
 */
const fs = require('fs');
const path = require('path');
const {
    test,
    prepare,
    settle,
    shot,
    openDashboard,
    DESKTOP,
    OUT,
} = require('./helpers/manual-shot-kit');
const { newsData, startNewsStub, watchSites, shiftFeedTimes } = require('./helpers/watch-news-mock');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** Settings changed in this test's copy of the data. */
const settingsTweak = (extra) => ({
    run(dir) {
        const file = path.join(dir, 'settings.json');
        writeJSON(file, { ...readJSON(file), showGridKeyLegend: false, ...extra });
    },
});

const COLOURS = { security: 'red', docs: 'blue', linux: 'orange', hardware: 'green', news: 'purple' };

/** The tag view, opened by its address as a reload of it would. */
async function openTagView(page, hash) {
    await openDashboard(page);
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    const view = page.locator('#dashboard-layout .tag-view');
    await view.waitFor({ state: 'visible' });
    await view.locator('.tag-view-row').first().waitFor();
    // Pacing for the capture, not a condition: the rows settle in.
    await page.waitForTimeout(1_200);
    return view;
}

test.describe('tag view', () => {
    test.use({ dataTweak: settingsTweak({}) });

    test('shot-1 the tag view for #security', async ({ page }) => {
        await prepare(page);
        await openTagView(page, '#tag/security');
        await shot(page, 'tag-view/shot-1.jpg');
    });

    test('shot-2 hardware and news', async ({ page }) => {
        await prepare(page);
        await openTagView(page, '#tag/hardware+news?all');
        await shot(page, 'tag-view/shot-2.jpg');
    });

    test('shot-3 every bookmark', async ({ page }) => {
        await prepare(page);
        await openTagView(page, '#tags');
        await shot(page, 'tag-view/shot-3.jpg');
    });

    test('shot-4 the Add tag window', async ({ page }) => {
        await prepare(page);
        await openTagView(page, '#tag/security');
        const checks = page.locator('.tag-view-row .tag-view-check');
        for (let i = 0; i < 3; i += 1) await checks.nth(i).click();
        await page.locator('.tag-view .tag-view-selbar').getByRole('button', { name: 'Add tag…' }).click();
        const input = page.locator('#app-modal input[data-tag-bulk-add]');
        await input.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the window finishes rising.
        await page.waitForTimeout(800);
        await shot(page, 'tag-view/shot-4.jpg');
    });

    test('shot-5 the Manage tag menu', async ({ page }) => {
        await prepare(page);
        await openTagView(page, '#tag/security');
        await page.locator('.tag-view [data-tag-view-manage]').click();
        await page.locator('.tag-view-manage-menu').waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        await shot(page, 'tag-view/shot-5.jpg');
    });
});

test.describe('tags', () => {
    test.use({ dataTweak: settingsTweak({ tagColors: COLOURS }) });

    test('v125-cloud coloured tag cloud', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('/');
        const cloud = page.locator('#tag-cloud-modal.is-open');
        await cloud.waitFor();
        // Pacing for the capture, not a condition: the cloud finishes drawing its words.
        await page.waitForTimeout(1_000);
        await page.evaluate(() => document.querySelectorAll('#tag-cloud-modal .is-keyboard-focused')
            .forEach((el) => el.classList.remove('is-keyboard-focused')));
        await shot(page, 'tags/v125-cloud.jpg');
    });

    test('v125-colours Config, Bookmarks, Tags', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.evaluate(() => { window.location.hash = '#config/bookmarks/tags'; });
        await page.waitForSelector('[data-tag-color-for]', { timeout: 20_000 });
        await settle(page);
        // The tags in use most lead the list, so the coloured ones are in it.
        await page.locator('select[data-pt-sort="tags"]').selectOption('count');
        await page.locator('[data-tag-color-for="security"]').waitFor();
        await page.locator('[data-tag-color-for="security"]').scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 330));
        // Pacing for the capture, not a condition: the page settles after the scroll.
        await page.waitForTimeout(800);
        await shot(page, 'tags/v125-colours.jpg');
    });
});

test.describe('tags, plain', () => {
    test.use({ dataTweak: settingsTweak({}) });

    test('shot-3 the cloud narrowed to typed letters', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('/');
        await page.locator('#tag-cloud-modal.is-open').waitFor();
        await page.waitForTimeout(600);
        await page.keyboard.type('sec', { delay: 80 });
        await page.waitForTimeout(800);
        await shot(page, 'tags/shot-3.jpg');
    });

    test('shot-4 the new bookmark form with tag chips', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('+');
        await page.getByRole('dialog', { name: 'Create New Bookmark' }).waitFor();
        await page.waitForTimeout(400);
        await page.keyboard.type('https://github.com/jellyfin/jellyfin', { delay: 10 });
        await page.keyboard.press('Tab');
        await page.locator('.tag-suggest-chips').waitFor({ state: 'visible' });
        await page.waitForTimeout(600);
        await shot(page, 'tags/shot-4.jpg');
    });
});

/*
 * Watch feeds: six news sites on the News category, their feeds answered by a
 * small server on this machine (tests/helpers/watch-news-mock.js).
 */
test.describe('watch feeds', () => {
    test.use({ dataTweak: { run(dir) { newsData(dir); settingsTweak({}).run(dir); } } });

    async function withNews(page, server) {
        const stub = await startNewsStub();
        try {
            await watchSites(server, stub);
        } finally {
            await stub.close();
        }
        await prepare(page);
        await shiftFeedTimes(page);
    }

    const newsRow = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();

    async function openConfig(page, section) {
        await openDashboard(page);
        await page.locator('.config-link-anchor').click();
        await page.locator('[data-config-section]').first().waitFor();
        await page.locator(`[data-config-section="${section}"]`).click();
        // Pacing for the capture, not a condition: Config settles after the section opens.
        await page.waitForTimeout(800);
        await settle(page);
    }

    test('shot-1 the News category with new items', async ({ page, server }) => {
        await withNews(page, server);
        await openDashboard(page);
        const link = newsRow(page, 'Northside Gazette');
        // The News category up under the header, with its six sites in view.
        await page.evaluate(() => {
            const cat = document.querySelector('#dashboard-layout .category[data-category="news"], #category-title-news')?.closest('.category');
            const top = cat?.getBoundingClientRect().top ?? 0;
            window.scrollBy(0, top - 120);
        });
        await link.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the page settles after the scroll.
        await page.waitForTimeout(1_200);
        await shot(page, 'watch-feeds/shot-1.jpg');
    });

    test('shot-2 the hover card of a news site', async ({ page, server }) => {
        await withNews(page, server);
        await openDashboard(page);
        const link = newsRow(page, 'Northside Gazette');
        await link.scrollIntoViewIfNeeded();
        await link.hover();
        const card = page.locator('.bookmark-preview-card').first();
        await card.waitFor({ state: 'visible' });
        await page.locator('.bookmark-preview-card-news-page').first().waitFor();
        // Pacing for the capture, not a condition: the headline's picture finishes loading.
        await page.waitForTimeout(1_800);
        // The card lives only while the pointer is on the row, so the frame is taken as it stands.
        await page.screenshot({ path: path.join(OUT, 'watch-feeds/shot-2.jpg'), type: 'jpeg', quality: 82 });
    });

    test('shot-3 the news window as a newspaper', async ({ page, server }) => {
        await withNews(page, server);
        await openDashboard(page);
        await page.keyboard.press('Shift+W');
        await page.locator('[data-feed-news]').waitFor({ state: 'visible' });
        await page.locator('.feed-news-view[data-feed-news-view="paper"]').click();
        await page.locator('.feed-news-view[data-feed-news-view="paper"][aria-pressed="true"]').waitFor();
        // The paper opens on its front page; one article opens with the others beside it.
        await page.locator('.feed-news-entry', { hasText: 'Harbour footbridge' }).first().click();
        await page.locator('.feed-news-side .feed-news-card').first().waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the window finishes drawing its pictures.
        await page.waitForTimeout(1_800);
        await shot(page, 'watch-feeds/shot-3.jpg');
    });

    test('shot-4 Config, Watch feeds', async ({ page, server }) => {
        await withNews(page, server);
        await openConfig(page, 'feed-watch');
        // Pacing for the capture, not a condition: the list finishes drawing its pictures.
        await page.waitForTimeout(1_800);
        await shot(page, 'watch-feeds/shot-4.jpg');
    });

    test('shot-5 Statistics, Watch feeds', async ({ page, server }) => {
        await withNews(page, server);
        await openConfig(page, 'stats');
        await page.getByRole('tab', { name: /Watch feeds/ }).last().click();
        // Pacing for the capture, not a condition: the charts finish drawing.
        await page.waitForTimeout(2_600);
        // The tab is taller than the frame: drawn smaller, so the figures, the chart, the health list and the table all stand in it.
        await page.evaluate(() => { document.documentElement.style.zoom = '0.74'; });
        await page.waitForTimeout(1_500);
        await shot(page, 'watch-feeds/shot-5.jpg');
    });
});

/** Config, opened the way a reader opens it, on one section. */
async function openConfigSection(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: Config settles after the section opens.
    await page.waitForTimeout(800);
    await settle(page);
}

test.describe('statistics', () => {
    test.use({ dataTweak: settingsTweak({}) });
    for (const [file, tab] of [['shot-3', 'collection'], ['shot-4', 'inbox'], ['shot-5', 'health'], ['shot-6', 'server']]) {
        test(`${file} the ${tab} tab`, async ({ page }) => {
            await prepare(page);
            await openConfigSection(page, 'stats');
            await page.locator(`[data-stats-tab="${tab}"]`).click();
            await page.locator('#config-stats-body .config-panel').first().waitFor({ state: 'visible' });
            // Pacing for the capture, not a condition: the charts finish drawing.
            await page.waitForTimeout(2_200);
            await shot(page, `statistics/${file}.jpg`);
        });
    }
});

test.describe('install', () => {
    test.use({ dataTweak: settingsTweak({}) });

    test.describe('first launch', () => {
        // The demo collection as a first launch finds it: the guide not yet answered or dismissed.
        test.use({
            dataTweak: {
                run(dir) {
                    const file = path.join(dir, 'settings.json');
                    const settings = readJSON(file);
                    const { baselineBookmarks, baselineTagged, templatePicked, ...rest } = settings.quickStart || {};
                    writeJSON(file, {
                        ...settings,
                        showGridKeyLegend: false,
                        onboardingCompleted: false,
                        quickStart: { ...rest, dismissed: false, visitedConfig: false, seenCheatsheet: false },
                    });
                },
            },
        });

        test('quick-start the Quick start guide', async ({ page }) => {
            await prepare(page);
            // The server calls the first page untouched only on a fresh install; the demo's has been edited, so the question is asked as a first launch would.
            await page.route('**/api/page-templates/bundled', async (route) => {
                const response = await route.fetch();
                await route.fulfill({ response, json: { ...(await response.json()), replacesMain: true } });
            });
            await page.goto('/');
            await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 30_000 });
            await page.locator('[data-start-guide-bar]').waitFor({ state: 'visible', timeout: 30_000 });
            // Pacing for the capture, not a condition: the bar finishes sliding in before it is clicked.
            await page.waitForTimeout(1_500);
            await page.locator('[data-start-guide-open]').click();
            await page.locator('[data-start-guide-modal]').waitFor({ state: 'visible' });
            // Pacing for the capture, not a condition: the modal finishes rising.
            await page.waitForTimeout(900);
            await shot(page, 'install/quick-start.jpg');
        });
    });

    test('new-1 step 1 of the dashboard tour', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press(':');
        await page.locator('#shortcut-search.show').waitFor();
        await page.keyboard.type('tour dashboard', { delay: 40 });
        await page.locator('.search-match', { hasText: /dashboard/i }).first().waitFor();
        await page.keyboard.press('Enter');
        const tour = page.locator('#app-modal.show .dashboard-tutorial-modal');
        await tour.waitFor({ timeout: 15_000 });
        await page.locator('.dashboard-tutorial-progress', { hasText: 'Step 1 of 10' }).waitFor();
        // Pacing for the capture, not a condition: the drawing of the step finishes.
        await page.waitForTimeout(1_500);
        await shot(page, 'install/new-1.jpg');
    });
});

test.describe('custom widgets', () => {
    test.use({ dataTweak: settingsTweak({}) });

    test('shot-2 the Custom widget editor with the AdGuard Home preset', async ({ page }) => {
        await prepare(page);
        await openConfigSection(page, 'widgets');
        await page.locator('[data-widget-catalogue]').first().click();
        await page.locator('#app-modal.show [data-widget-option="custom"]').first().click();
        await page.locator('#app-modal.show [data-widget-add="custom"]').click();
        // Custom connects first; nothing typed adds it as it was.
        await page.locator('[data-widget-wizard-finish]').click();
        const preset = page.locator('[data-widget-preset]').last();
        await preset.waitFor();
        await preset.selectOption('adguard');
        const address = page.locator('[data-widget-setting="url"]').last();
        await address.fill('http://adguard.lab.example:3000/control/stats');
        await address.press('Tab');
        await page.locator('[data-widget-auth="basicUser"]').last().fill('admin');
        await page.locator('[data-widget-auth="secret"]').last().fill('not-a-real-password');
        // The preset's notice goes by itself; it would cover the fields.
        await page.waitForFunction(() => !document.querySelector('.app-notification.show, #app-notification.show'), null, { timeout: 15_000 }).catch(() => {});
        // The editor is a window: scrolled so the Ask now button and the first figures stand whole.
        await page.evaluate(() => {
            for (let el = document.querySelector('[data-custom-test]'); el; el = el.parentElement) {
                if (el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
                    el.scrollTop += 120;
                    break;
                }
            }
        });
        // Pacing for the capture, not a condition: the window settles after the scroll.
        await page.waitForTimeout(800);
        await shot(page, 'custom-widgets/shot-2.jpg');
    });
});

test.describe('page templates', () => {
    // Homelab gets two links on home-network addresses (made up), which a template turns into values to fill in.
    test.use({
        dataTweak: {
            run(dir) {
                settingsTweak({}).run(dir);
                const file = path.join(dir, 'bookmarks-2.json');
                const data = readJSON(file);
                const at = Date.now();
                [['Media server', 'http://192.168.1.20:8096/web/', 'MS'], ['Download manager', 'http://192.168.1.20:8080/', 'DM']].forEach(([name, url, shortcut], i) => data.bookmarks.push({
                    name, url, shortcut, pageId: 2, category: '', checkStatus: false, createdAt: at - (i + 5) * 86_400_000, tags: ['media'],
                }));
                writeJSON(file, data);
            },
        },
    });

    test('shot-2 importing a page template', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
        await page.locator('[data-pt-tab="pages"]').click();
        await page.locator('[data-page-row]').first().waitFor({ state: 'visible' });
        // A page with a link on a home-network address: exported as a file, then read back in.
        await page.locator('[data-page-template="2"]').click();
        const exportDialog = page.locator('#config-template-export');
        await exportDialog.waitFor({ state: 'visible' });
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            exportDialog.locator('[data-form-dialog="ok"]').click(),
        ]);
        const file = fs.readFileSync(await download.path(), 'utf8');
        await page.locator('[data-page-template-import]').click();
        const dialog = page.locator('#config-template-import');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator('[data-tpl-file]').setInputFiles({ name: 'homelab.nextdash-page.json', mimeType: 'application/json', buffer: Buffer.from(file) });
        await dialog.locator('[data-tpl-value]').first().waitFor({ state: 'visible', timeout: 15_000 });
        const values = dialog.locator('[data-tpl-value]');
        for (let i = 0; i < await values.count(); i += 1) await values.nth(i).fill('https://media.example.net');
        // Pacing for the capture, not a condition: the dialog finishes drawing its preview.
        await page.waitForTimeout(800);
        await shot(page, 'page-templates/shot-2.jpg');
    });
});
