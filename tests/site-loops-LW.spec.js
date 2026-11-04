// @ts-check
/* Loops (loop.webm) for the nextdash.cc pages widgets and custom-widgets. */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test, prepare, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'Set MANUAL_SHOTS=1 to record the site loops.');
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

const OUT = process.env.SHOTS_OUT || '/private/tmp/claude-501/agents/loops-LW';
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
// Pacing for the capture, not a condition: the viewer gets time to read the frame.
const hold = (page, ms) => page.waitForTimeout(ms);

async function newScene(browser, baseURL) {
    const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-loop-video-'));
    const context = await browser.newContext({
        baseURL, viewport: DESKTOP, reducedMotion: 'reduce',
        recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    return { page: await context.newPage(), context };
}

async function finish(scene, slug, startAt, endAt) {
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    const video = scene.page.video();
    await scene.context.close();
    const src = await video.path();
    const seconds = Math.min(12.5, Math.round((endAt - startAt) * 10) / 10);
    const raw = path.join(dir, 'raw.webm');
    fs.copyFileSync(src, raw);
    writeJSON(path.join(dir, 'loop.json'), { video: raw, startAt, seconds });
    console.log(`${slug}: startAt ${startAt} seconds ${seconds} (recorded ${endAt - startAt})`);
}

async function openConfig(page, section) {
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    await hold(page, 700);
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    await page.locator('.config-panel, #config-db-body').first().waitFor();
}

test('widgets loop', async ({ browser, baseURL }) => {
    const { page, context } = await newScene(browser, baseURL);
    const t0 = Date.now();
    await prepare(page);
    await openDashboard(page, '#2');
    await page.locator('[data-widget-type="uptime"]').first().waitFor();
    await hold(page, 1500);
    await page.mouse.move(5, 895);
    const startAt = (Date.now() - t0) / 1000;
    await hold(page, 800);
    await openConfig(page, 'widgets');
    await hold(page, 500);
    await page.locator('[data-widget-catalogue]').first().click();
    const option = page.locator('#app-modal.show [data-widget-option="uptime"]').first();
    await option.waitFor();
    await hold(page, 800);
    await option.click();
    await hold(page, 1800);
    await page.locator('#app-modal.show [data-widget-add="uptime"]').click();
    await page.getByText('Show a sparkline per row').first().waitFor({ timeout: 10_000 });
    await hold(page, 1100);
    await page.keyboard.press('Escape');
    await page.getByText('Show a sparkline per row').first().waitFor({ state: 'hidden', timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.locator('.category').first().waitFor({ state: 'visible' });
    await page.mouse.move(5, 895);
    await hold(page, 800);
    const tiles = page.locator('[data-widget-type="uptime"]');
    await tiles.nth(1).waitFor();
    const box = await tiles.nth(1).boundingBox();
    const total = Math.max(0, (box ? box.y : 0) - 220);
    await page.mouse.move(700, 500);
    for (let i = 0; i < 12; i += 1) {
        await page.mouse.wheel(0, total / 12);
        // Pacing for the capture, not a condition: one step of the scroll.
        await page.waitForTimeout(60);
    }
    await hold(page, 2000);
    for (let i = 0; i < 12; i += 1) {
        await page.mouse.wheel(0, -total / 12);
        await page.waitForTimeout(60);
    }
    await page.mouse.move(5, 895);
    await hold(page, 700);
    const endAt = (Date.now() - t0) / 1000;
    await finish({ page, context }, 'widgets', startAt, endAt);
});

async function startSonarrStub() {
    const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'widget-presets', 'sonarr.json'), 'utf8'));
    const answer = { ...recorded.body, totalCount: 4, count: 3, unknownCount: 1 };
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {import('net').AddressInfo} */ (server.address());
    return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('custom widgets loop', async ({ browser, baseURL }) => {
    const stub = await startSonarrStub();
    const { page, context } = await newScene(browser, baseURL);
    try {
        const t0 = Date.now();
        await prepare(page);
        await page.route('**/api/widgets/custom/test', async (route) => {
            const sent = JSON.parse(route.request().postData() || '{}');
            const shown = new URL(sent.url);
            sent.url = `${stub.origin}${shown.pathname}`;
            const response = await route.fetch({ postData: JSON.stringify(sent) });
            const body = await response.json();
            body.host = shown.host;
            body.tookMs = 38;
            await route.fulfill({ response, json: body });
        });
        await openDashboard(page);
        await page.mouse.move(5, 895);
        const startAt = (Date.now() - t0) / 1000;
        await hold(page, 800);
        await openConfig(page, 'widgets');
        await page.locator('[data-widget-catalogue]').first().click();
        await page.locator('#app-modal.show [data-widget-option="custom"]').first().click();
        await hold(page, 500);
        await page.locator('#app-modal.show [data-widget-add="custom"]').click();
        await page.locator('[data-widget-wizard-finish]').click();
        const preset = page.locator('[data-widget-preset]').last();
        await preset.waitFor();
        await hold(page, 800);
        await preset.selectOption('sonarr');
        const address = page.locator('[data-widget-setting="url"]').last();
        await address.fill('http://sonarr.lab.example:8989/api/v3/queue/status');
        await address.press('Tab');
        await page.locator('[data-widget-auth="secret"]').last().fill('demo-key-not-a-real-one');
        // The preset's notice would sit over the editor's corner for the length of the loop.
        await page.addStyleTag({ content: '#app-notification, .app-notification { display: none !important; }' });
        await page.locator('[data-custom-test]').last().scrollIntoViewIfNeeded();
        await hold(page, 1500);
        await page.locator('[data-custom-test]').last().click();
        await page.getByText('What came back').first().waitFor();
        await page.locator('[data-custom-field="path"]').first().scrollIntoViewIfNeeded();
        await hold(page, 3600);
        await page.getByRole('dialog', { name: 'Custom' }).getByRole('button', { name: 'Close' }).click();
        await page.getByText('Discard unsaved changes?').waitFor();
        await hold(page, 300);
        await page.getByRole('button', { name: 'Discard' }).last().click();
        await page.locator('[data-custom-test]').first().waitFor({ state: 'hidden', timeout: 10_000 });
        await page.keyboard.press('Escape');
        await page.locator('.category').first().waitFor({ state: 'visible' });
        await page.mouse.move(5, 895);
        await hold(page, 800);
        const endAt = (Date.now() - t0) / 1000;
        await finish({ page, context }, 'custom-widgets', startAt, endAt);
    } finally {
        await stub.close();
    }
});
