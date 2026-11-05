// @ts-check
/*
 * Feature-page screenshots for nextdash.cc, set C: notes and digest, pages and
 * categories, phones, recents, settings. Full frames, Tarnished Brass dark,
 * on the public demo seed.
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> SHOTS_OUT=<dir> \
 *     npx playwright test tests/site-shots-C.spec.js
 */
const fs = require('fs');
const path = require('path');
const {
    test,
    prepare,
    shot,
    openDashboard,
    settle,
    readJSON,
    writeJSON,
    NOW,
    DESKTOP,
    PHONE,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const row = (page, name) => page.locator('#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link', { hasText: name }).first();
const modal = (page) => page.locator('#app-modal.show .modal');

/** Let a toast that is on its way come and go. */
async function waitOutNotice(page) {
    const toast = page.locator('#app-notification.show');
    await toast.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

/** Config, by the gear in the header, then a section on its rail. */
async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: the section finishes drawing.
    await page.waitForTimeout(800);
    await settle(page);
}

const subtab = (page, label) => page.locator('.config-subtab', { hasText: label }).first();

/** A full frame that keeps the focus where it stands (the kit's shot lets it go). */
async function frame(page, name) {
    const view = page.viewportSize();
    await page.mouse.move(5, view.height - 5);
    // Pacing for the capture, not a condition: a hover state lets go.
    await page.waitForTimeout(300);
    fs.mkdirSync(path.dirname(path.join(process.env.SHOTS_OUT, name)), { recursive: true });
    await page.screenshot({ path: path.join(process.env.SHOTS_OUT, name), type: 'jpeg', quality: 82 });
}

/** The Bookmarks view, by its header icon. */
async function openBookmarksView(page) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
}

/* ------------------------------------------------------------------ */
/* notes-and-digest                                                    */
/* ------------------------------------------------------------------ */

const NOTE_ARCH = 'Start with the installation guide, the ZFS chapter is the one I need for the NAS';

/** Notes on two bookmarks of the Dev page, and a richer note in the Notes widget. */
function notesData(dir) {
    const file = path.join(dir, 'bookmarks-1.json');
    const data = readJSON(file);
    const notes = { 'Arch Wiki': NOTE_ARCH, 'tldr pages': 'The short version when man pages are too much' };
    for (const b of data.bookmarks) if (notes[b.name]) b.note = notes[b.name];
    const widget = (data.widgets || []).find((w) => w.type === 'notes');
    if (widget) {
        widget.config = {
            ...(widget.config || {}),
            text: [
                '# Weekend plan',
                '',
                '[x] Renew the domain',
                '[x] Clean out the Inbox',
                '[x] Check the backup report',
                '[ ] Update the router',
                '',
                '## Next up',
                '',
                '- Move the media share to the new pool',
                '- Try the ZFS snapshots',
                '- Write down the restore steps',
                '',
                '> A backup you have not restored is a hope, not a backup.',
            ].join('\n'),
        };
    }
    writeJSON(file, data);
}

test.describe('notes', () => {
    test.use({ dataTweak: { run: notesData } });

    test('notes shot 1: preview card with a note', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await row(page, 'Arch Wiki').hover();
        const card = page.locator('.bookmark-preview-card').first();
        await card.waitFor({ state: 'visible' });
        await card.getByText(NOTE_ARCH.slice(0, 30)).first().waitFor();
        // Pacing for the capture, not a condition: the card finishes drawing its picture.
        await page.waitForTimeout(1_200);
        // The shot helper moves the pointer away, which would close the card.
        await page.screenshot({ path: path.join(process.env.SHOTS_OUT, 'notes-and-digest/shot-1.jpg'), type: 'jpeg', quality: 82 });
    });

    test('notes shot 2: edit form with the note', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await row(page, 'Arch Wiki').click({ button: 'right' });
        await page.locator('.bookmark-context-menu').first().getByText(/^Edit/).first().click();
        const form = page.getByRole('dialog', { name: 'Edit Bookmark' });
        await form.waitFor();
        const note = form.getByRole('textbox').last();
        await form.getByText('Note', { exact: true }).waitFor();
        await note.scrollIntoViewIfNeeded();
        // Pacing for the capture, not a condition: the form finishes opening.
        await page.waitForTimeout(1_200);
        await shot(page, 'notes-and-digest/shot-2.jpg');
    });

    test('notes shot 3: notes widget open large', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.locator('.dashboard-widget-note-expand').click();
        const dlg = page.locator('.notes-modal-overlay');
        await dlg.waitFor({ state: 'visible' });
        await dlg.locator('.notes-modal-preview .dashboard-widget-note-task').first().waitFor();
        // Pacing for the capture, not a condition: the modal finishes opening.
        await page.waitForTimeout(1_000);
        await shot(page, 'notes-and-digest/shot-3.jpg');
    });
});

test('digest shot 4: the weekly digest window', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    const res = await page.request.post('/api/digest/test');
    test.skip(res.status() === 204, 'the seed has nothing to put in a digest');
    await page.keyboard.press(':');
    await page.keyboard.type('digest');
    await page.keyboard.press('Enter');
    await page.locator('.digest-modal .digest-window').waitFor({ timeout: 15_000 });
    // Pacing for the capture, not a condition: the window finishes drawing.
    await page.waitForTimeout(1_200);
    await shot(page, 'notes-and-digest/shot-4.jpg');
});

test('digest shot 5: config digest panel', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'monitoring');
    await subtab(page, 'Notifications').click();
    await page.addStyleTag({ content: '.config-form-keyboard-legend { display: none !important; }' });
    await page.locator('[data-behavior-field="digestWeekday"]').first().waitFor();
    await page.locator('[data-behavior-field="digestWeekday"]').first().scrollIntoViewIfNeeded();
    // Pacing for the capture, not a condition: the scroll settles.
    await page.waitForTimeout(800);
    await shot(page, 'notes-and-digest/shot-5.jpg');
});

/* ------------------------------------------------------------------ */
/* pages-and-categories                                                */
/* ------------------------------------------------------------------ */

test('pages shot 1: the sort menu of Privacy', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#3');
    const privacy = page.locator('#dashboard-layout .category[data-category-id="privacy"]').first();
    await privacy.scrollIntoViewIfNeeded();
    // Sorting A to Z first, so the chip stands in the header; the menu then opens over it.
    await privacy.locator('.category-sort-menu-btn').first().click();
    await page.locator('.category-sort-menu-item[data-sort-mode="az"]').first().click();
    await privacy.locator('.category-sort-controls').getByText(/A.?Z/).first().waitFor();
    await privacy.locator('.category-sort-menu-btn').first().click();
    await page.locator('.category-sort-menu').waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the menu finishes opening.
    await page.waitForTimeout(600);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.screenshot({ path: path.join(process.env.SHOTS_OUT, 'pages-and-categories/shot-1.jpg'), type: 'jpeg', quality: 82 });
});

test('pages shot 2: right-click menu on Apps', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#3');
    await page.locator('#category-title-apps').click({ button: 'right' });
    const menu = page.locator('.bookmark-context-menu').first();
    await menu.waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the menu finishes opening.
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(process.env.SHOTS_OUT, 'pages-and-categories/shot-2.jpg'), type: 'jpeg', quality: 82 });
});

function spreadData(dir) {
    const settingsFile = path.join(dir, 'settings.json');
    writeJSON(settingsFile, { ...readJSON(settingsFile), categoryItemLimit: 5, showGridKeyLegend: false });
    const file = path.join(dir, 'bookmarks-3.json');
    const data = readJSON(file);
    const privacy = data.categories.find((c) => c.id === 'privacy');
    if (privacy) privacy.spread = true;
    writeJSON(file, data);
}

test.describe('spread', () => {
    test.use({ dataTweak: { run: spreadData } });
    test('pages shot 3: Privacy spread over two columns', async ({ page }) => {
        await prepare(page);
        await openDashboard(page, '#3');
        const privacy = page.locator('#dashboard-layout .category[data-category-id="privacy"]').first();
        await privacy.waitFor();
        // Privacy sits below the fold; bring it up under the header.
        await privacy.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 150));
        // Pacing for the capture, not a condition: the scroll settles.
        await page.waitForTimeout(600);
        await shot(page, 'pages-and-categories/shot-3.jpg');
    });
});

test('pages shot 4: the pages panel', async ({ page }) => {
    await prepare(page);
    await openDashboard(page, '#3');
    await page.keyboard.press('Shift+P');
    await page.locator('.page-overview-modal').waitFor({ state: 'visible' });
    // Pacing for the capture, not a condition: the panel finishes opening.
    await page.waitForTimeout(800);
    await shot(page, 'pages-and-categories/shot-4.jpg');
});

test('pages shot 5: the trash with Homelab in it', async ({ page }) => {
    await prepare(page);
    // The server stamps a deletion with its own time; the shots' clock stands elsewhere.
    await page.route('**/api/trash', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = await response.json();
        (body.items || []).forEach((item) => { item.deletedAt = NOW.getTime() - 15_000; });
        return route.fulfill({ response, json: body });
    });
    await openDashboard(page, '#2');
    await page.keyboard.press('Shift+P');
    await page.locator('.page-overview-modal').waitFor({ state: 'visible' });
    const del = page.locator('.page-overview-modal-delete[data-page-delete="2"]');
    await del.click();
    await del.click();
    await page.locator('.page-overview-modal').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    await waitOutNotice(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section="data-backups"]').click();
    await subtab(page, 'Trash').click();
    await page.locator('.config-panel-title', { hasText: 'Deleted items' }).first().waitFor();
    await page.getByText('Homelab').first().waitFor();
    await waitOutNotice(page);
    await page.addStyleTag({ content: '.config-form-keyboard-legend { display: none !important; }' });
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
    await shot(page, 'pages-and-categories/shot-5.jpg');
});

/* ------------------------------------------------------------------ */
/* recents                                                             */
/* ------------------------------------------------------------------ */

test.describe('recents sheet', () => {
    // The sheet slides in; reduced motion takes that away and it then runs off the edge.
    test.use({ reducedMotion: 'no-preference' });

    test('recents shot 1: first page', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('*');
        await page.locator('#app-modal.show .recent-bookmarks-modal').waitFor();
        await page.locator('#app-modal.show .recent-bookmarks-modal').getByText(/of \d+/).first().waitFor();
        // Pacing for the capture, not a condition: the sheet finishes sliding in.
        await page.waitForTimeout(1_200);
        await shot(page, 'recents/shot-1.jpg');
    });

});


/** The opens from the twenty-first on a day earlier, so the third page shows the day before. */
function olderOpens(dir) {
    const files = fs.readdirSync(dir).filter((f) => /^bookmarks-\d+\.json$/.test(f));
    const pages = files.map((f) => ({ file: path.join(dir, f), data: readJSON(path.join(dir, f)) }));
    const opened = pages.flatMap((p) => (p.data.bookmarks || []).filter((b) => b.lastOpened > 0)).sort((x, y) => y.lastOpened - x.lastOpened);
    opened.slice(20).forEach((b) => { b.lastOpened -= 14 * 3_600_000; });
    pages.forEach((p) => writeJSON(p.file, p.data));
}

test.describe('recents, the third page', () => {
    test.use({ reducedMotion: 'no-preference', dataTweak: { run: olderOpens } });
    test('recents shot 2: third page', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await page.keyboard.press('*');
        const sheet = page.locator('#app-modal.show .recent-bookmarks-modal');
        await sheet.waitFor();
        await sheet.getByText(/of \d+/).first().waitFor();
        // Pacing for the capture, not a condition: the sheet finishes sliding in.
        await page.waitForTimeout(1_000);
        // The pager's own key, shown at its foot.
        await page.keyboard.press(']');
        await sheet.getByText(/11.{1,3}20 of/).first().waitFor();
        await page.keyboard.press(']');
        await sheet.getByText(/21.{1,3}30 of/).first().waitFor();
        // Pacing for the capture, not a condition: the tiles finish drawing.
        await page.waitForTimeout(800);
        await shot(page, 'recents/shot-2.jpg');
    });
});

test.describe('github card', () => {
    test('recents shot 3: preview card of GitHub', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        // The Today collection stands at the top of the page, so the hover needs no scroll.
        await page.locator('#dashboard-layout .category[data-smart-collection="true"] .bookmark-link', { hasText: 'GitHub' }).first().hover();
        const card = page.locator('.bookmark-preview-card').first();
        await card.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the card finishes drawing its picture.
        await page.waitForTimeout(1_500);
        await page.screenshot({ path: path.join(process.env.SHOTS_OUT, 'recents/shot-3.jpg'), type: 'jpeg', quality: 82 });
    });
});

test('recents shot 4: usually now in the empty search panel', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    // The group is worked out from the time of day the panel opens at.
    await page.clock.setFixedTime(new Date('2026-10-27T10:30:00'));
    await page.keyboard.press('>');
    await page.locator('#shortcut-search .search-container').waitFor();
    // Pacing for the capture, not a condition: the panel finishes opening.
    await page.waitForTimeout(900);
    await shot(page, 'recents/shot-4.jpg');
});

test('recents shot 5: added:month opened:never', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press('>');
    await page.locator('#shortcut-search .search-container').waitFor();
    await page.keyboard.type('added:month opened:never', { delay: 40 });
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(1_000);
    await shot(page, 'recents/shot-5.jpg');
});

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

const hideFormLegend = (page) => page.addStyleTag({ content: '.config-form-keyboard-legend { display: none !important; }' });

test('settings shot 1: config overview', async ({ page }) => {
    await prepare(page);
    await openConfig(page);
    await page.locator('.config-overview-tip').waitFor();
    // Pacing for the capture, not a condition: the panels finish drawing.
    await page.waitForTimeout(1_500);
    // Down just far enough for the Tip panel, with the attention line still under the head.
    await page.mouse.wheel(0, 170);
    // Pacing for the capture, not a condition: the scroll settles.
    await page.waitForTimeout(600);
    await shot(page, 'settings/shot-1.jpg');
});

test('settings shot 2: find settings, hotkey', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'behavior');
    await page.keyboard.press('ControlOrMeta+Shift+K');
    const finder = page.locator('#app-modal.show .config-settings-jump-modal');
    await finder.waitFor();
    await finder.locator('input').first().click();
    await page.keyboard.type('hotkey', { delay: 60 });
    await page.locator('.config-settings-jump-result').first().waitFor();
    // Pacing for the capture, not a condition: the list finishes drawing.
    await page.waitForTimeout(800);
    await frame(page, 'settings/shot-2.jpg');
});

test('settings shot 3: keyboard panel', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'behavior');
    await subtab(page, 'Keyboard').click();
    await hideFormLegend(page);
    const field = page.locator('[data-behavior-field="globalShortcuts"]').first();
    await field.waitFor();
    await field.scrollIntoViewIfNeeded();
    // Pacing for the capture, not a condition: the scroll settles.
    await page.waitForTimeout(800);
    await shot(page, 'settings/shot-3.jpg');
});

/** Three settings off their default on General, and two on Privacy and sync. */
function changedData(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, {
        ...readJSON(file),
        rememberScrollPosition: false,
        lockLayout: true,
        openInNewTab: false,
        enableSessionTips: false,
    });
}

test.describe('only changed', () => {
test.use({ dataTweak: { run: changedData } });
test('settings shot 4: only changed on General', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'behavior');
    await subtab(page, 'General').click();
    await hideFormLegend(page);
    await page.locator('[data-config-action="toggle-changed"]').first().click();
    // Pacing for the capture, not a condition: the list narrows.
    await page.waitForTimeout(800);
    await shot(page, 'settings/shot-4.jpg');
});
});

test('settings shot 5: Appearance background, section list focused', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    await subtab(page, 'Background').click();
    // Pacing for the capture, not a condition: the tab finishes drawing.
    await page.waitForTimeout(800);
    await page.locator('[data-config-section="appearance"]').focus();
    await frame(page, 'settings/shot-5.jpg');
});

/* ------------------------------------------------------------------ */
/* phones                                                              */
/* ------------------------------------------------------------------ */

const { newsData, startNewsStub, watchSites, shiftFeedTimes } = require('./helpers/watch-news-mock');

/** The one-time note about the phone layout, closed with its cross. */
async function closePhoneNote(page) {
    const note = page.getByRole('button', { name: 'Dismiss' }).first();
    if (await note.isVisible().catch(() => false)) await note.click();
}

test.describe('phones', () => {
    test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    test('phones shot 1: the dashboard', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await closePhoneNote(page);
        // The tap leaves the row under it lit; a tap on the title lets go.
        await page.locator('h1').first().click().catch(() => {});
        // Pacing for the capture, not a condition: the page settles.
        await page.waitForTimeout(800);
        await shot(page, 'phones/shot-1.jpg');
    });

    test('phones shot 3: the Bookmarks view', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await closePhoneNote(page);
        await page.goto('/#bookmarks');
        await page.locator('#config-bm-list .config-bm-row').first().waitFor();
        await settle(page);
        // Pacing for the capture, not a condition: the list finishes drawing.
        await page.waitForTimeout(1_000);
        await shot(page, 'phones/shot-3.jpg');
    });

    test('phones shot 4: the search panel', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await closePhoneNote(page);
        // The group is worked out from the time of day the panel opens at.
        await page.clock.setFixedTime(new Date('2026-10-27T10:30:00'));
        await page.keyboard.press('>');
        await page.locator('#shortcut-search .search-container').waitFor();
        // Pacing for the capture, not a condition: the panel finishes opening.
        await page.waitForTimeout(1_000);
        await shot(page, 'phones/shot-4.jpg');
    });

    test('phones shot 5: Config overview', async ({ page }) => {
        await prepare(page);
        await openDashboard(page);
        await closePhoneNote(page);
        await page.goto('/#config/overview');
        await page.locator('[data-config-section]').first().waitFor();
        await settle(page);
        // Pacing for the capture, not a condition: the panels finish drawing.
        await page.waitForTimeout(1_500);
        await shot(page, 'phones/shot-5.jpg');
    });
});

test.describe('phones with news', () => {
    test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, dataTweak: { run: newsData } });

    test('phones shot 2: the news popover', async ({ page, server }) => {
        const stub = await startNewsStub();
        try {
            await watchSites(server, stub);
        } finally {
            await stub.close();
        }
        await prepare(page);
        await shiftFeedTimes(page);
        await openDashboard(page);
        await closePhoneNote(page);
        const link = row(page, 'Northside Gazette');
        await link.tap();
        const pop = page.locator('.feed-news-pop');
        await pop.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the popover grows in.
        await page.waitForTimeout(1_200);
        await page.screenshot({ path: path.join(process.env.SHOTS_OUT, 'phones/shot-2.jpg'), type: 'jpeg', quality: 82 });
    });
});
