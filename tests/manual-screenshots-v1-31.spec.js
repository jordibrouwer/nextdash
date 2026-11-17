// @ts-check
/*
 * The MANUAL.md screenshots of v1.31.0: a reminder on a bookmark (the menu and
 * the bell row), the related links on a preview card, and the Compose stack
 * panel (services and the editor). Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-31.spec.js
 */
const { test, prepare, settle, snap, crop, openDashboard, NOW, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

/** A bookmark row on the grid, by its name. */
const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();

test.describe('reminders', () => {
    test('06 the reminder menu', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await row(page, 'Hack The Box').click({ button: 'right' });
        await page.locator('.bookmark-context-menu').first().waitFor({ state: 'visible' });
        await page.locator('.bookmark-context-menu [data-action="remind"], .bookmark-context-menu >> text=Remind me').first().click();
        const menu = page.locator('#reminder-menu');
        await menu.waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        await snap(page, menu, '06-reminder-menu.jpg', { pad: 16 });
    });

    test('06 the bell with a reminder that came due', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // The reminder was set yesterday for this morning: the server holds it, as it would after the time passed.
        await page.evaluate(async (at) => {
            const d = window.dashboardInstance;
            const bookmark = d.reminders._everyBookmark().find((b) => /Hack The Box/i.test(b.name || ''));
            if (!bookmark) throw new Error('no Hack The Box bookmark');
            await d.reminders.set({ bookmark, pageId: Number(bookmark.pageId) || Number(d.currentPageId) }, at);
            await d.reminders.refreshDue();
        }, NOW.getTime() - 2 * 3_600_000);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await page.evaluate(() => window.NotificationBell.open());
        await page.locator('.notification-bell-row[data-bell-id="reminders-due"]').waitFor({ state: 'visible', timeout: 15_000 });
        // Pacing for the capture, not a condition: the panel finishes sliding in.
        await page.waitForTimeout(900);
        await snap(page, page.locator('.notification-bell-panel').first(), '06-reminder-bell.jpg', { pad: 12, maxHeight: 520 });
    });
});

test('04 related links on the preview card', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await row(page, 'Arch Wiki').hover();
    const card = page.locator('.bookmark-preview-card').first();
    await card.waitFor({ state: 'visible' });
    await card.locator('.bookmark-related-chip').first().waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(1_200);
    await crop(page, card, '04-related-links.jpg');
});

const arrFile = {
    id: 'c0', role: 'compose', hostPath: '/opt/stacks/arr/compose.yml', state: 'ok', size: 612, sha256: 'abcdef0123456789',
    writable: true, masked: [{ key: 'services.sonarr.environment.API_KEY', line: 9 }], yamlError: null, warnings: [],
    content: [
        'services:',
        '  sonarr:',
        '    image: linuxserver/sonarr:latest',
        '    ports:',
        '      - "8989:8989"',
        '    volumes:',
        '      - ./sonarr:/config',
        '    environment:',
        '      TZ: Europe/Amsterdam',
        '      API_KEY: ••••••',
        '  radarr:',
        '    image: linuxserver/radarr:latest',
        '    ports:',
        '      - "7878:7878"',
        '',
    ].join('\n'),
};
const arrAnswer = {
    project: 'arr', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/arr',
    mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
    suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:rw' }, files: [arrFile],
};

async function openStack(page) {
    const { docker } = await prepare(page);
    docker.compose = { arr: arrAnswer };
    docker.composeStatus = { map: [{ host: '/opt/stacks', container: '/stacks' }], rejected: [] };
    await openDashboard(page);
    await page.locator('#page-nav-docker-host .docker-link-anchor').click();
    await page.locator('[data-docker-row]').first().waitFor();
    await settle(page);
    await page.locator('[data-docker-group]').selectOption('project');
    await page.locator('[data-docker-stack-files="arr"]').click();
    const panel = page.locator('[data-docker-stack-panel="arr"]');
    await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(1_000);
    return panel;
}

test.describe('the Compose stack panel', () => {
    test('14 the stack panel, services', async ({ page }) => {
        const panel = await openStack(page);
        await crop(page, page.locator('[data-lvs-drawer-panel]').first(), '14-stack-services.jpg', 0);
        void panel;
    });

    test('14 the stack panel, editing a compose file', async ({ page }) => {
        const panel = await openStack(page);
        await panel.locator('[data-slp-tab="compose"]').click();
        await panel.locator('[data-docker-compose-edit]').first().click();
        const box = panel.locator('[data-docker-compose-editor]').first();
        await box.waitFor({ state: 'visible' });
        // End moves the page, not the cursor, on macOS: put the cursor at the end of the text itself.
        await box.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
        await page.keyboard.type('    # moved from 7878\n', { delay: 5 });
        await panel.locator('[data-docker-compose-check]').click();
        // Pacing for the capture, not a condition: the answer of Check is drawn.
        await page.waitForTimeout(900);
        await crop(page, page.locator('[data-lvs-drawer-panel]').first(), '14-stack-compose.jpg', 0);
    });
});
