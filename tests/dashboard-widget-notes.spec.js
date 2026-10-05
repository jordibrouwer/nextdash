// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');
const fs = require('fs');
const path = require('path');

const markdownCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/notes-markdown-cases.json'), 'utf8'));
const commandCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/notes-command-cases.json'), 'utf8'));

/**
 * The notes widget: text of your own, with tickable lines.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Put one notes widget on the current page, through the API the dashboard uses. */
async function addNotes(page, text) {
    return page.evaluate(async (initial) => {
        const d = window.dashboardInstance;
        const pageId = Number(d.currentPageId);
        const before = Array.isArray(d.widgets) ? d.widgets : [];
        const widgets = [...before.filter((w) => w.type !== 'notes'),
            { id: 'w_notes_e2e', type: 'notes', title: 'Notes e2e', config: initial ? { text: initial } : {} }];
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        const res = await fetch(`/api/pages/${pageId}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return pageId;
    }, text);
}

async function storedText(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/pages/${id}/blocks`, { cache: 'no-store' });
        const body = await res.json();
        const w = (body.widgets || []).find((x) => x.type === 'notes');
        return w?.config?.text ?? null;
    }, pageId);
}

async function removeNotes(page, pageId) {
    await page.evaluate(async (id) => {
        const res = await fetch(`/api/pages/${id}/blocks`, { cache: 'no-store' });
        const body = await res.json();
        const widgets = (body.widgets || []).filter((x) => x.type !== 'notes');
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        await fetch(`/api/pages/${id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets }) });
    }, pageId);
}

/** Set the notes widget's width through the same blocks API addNotes uses. */
async function setNotesColumns(page, pageId, columns) {
    await page.evaluate(async ({ id, cols }) => {
        const res = await fetch(`/api/pages/${id}/blocks`, { cache: 'no-store' });
        const body = await res.json();
        const widgets = (body.widgets || []).map((w) => {
            if (w.type !== 'notes') return w;
            const config = { ...(w.config || {}) };
            if (cols === 2) config.columns = 2; else delete config.columns;
            return { ...w, config };
        });
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        const put = await fetch(`/api/pages/${id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets }) });
        if (!put.ok) throw new Error(`HTTP ${put.status}`);
    }, { id: pageId, cols: columns });
}

test.describe('the notes widget', () => {
    test('it is offered and has a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return { offered: [...(Config?.WIDGET_TYPES || [])], renderer: typeof window.DashboardWidgets?.notes };
        });
        expect(state.offered).toContain('notes');
        expect(state.renderer).toBe('function');
    });

    test('lines with [ ] and [x] are checkboxes, and ticking one saves that line', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, '[ ] close port 8443\n[x] replace disk\nplain line');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            const tile = page.locator('.dashboard-widget[data-widget-id="w_notes_e2e"]');
            await expect(tile.locator('input[type="checkbox"]')).toHaveCount(2);
            await expect(tile.locator('input[type="checkbox"]').nth(0)).not.toBeChecked();
            await expect(tile.locator('input[type="checkbox"]').nth(1)).toBeChecked();
            await expect(tile.locator('.dashboard-widget-note-text')).toHaveText('plain line');

            await tile.locator('input[type="checkbox"]').nth(0).check();
            await expect.poll(() => storedText(page, pageId))
                .toBe('[x] close port 8443\n[x] replace disk\nplain line');
        } finally {
            await removeNotes(page, pageId);
        }
    });

    // The text can change under a drawn tile (another tab): ticking finds its
    // line by what it says, not by where it was.
    test('ticking after the text changed elsewhere ticks the same line', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, '[ ] close port 8443\n[ ] replace disk');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            const tile = page.locator('.dashboard-widget[data-widget-id="w_notes_e2e"]');
            await expect(tile.locator('input[type="checkbox"]')).toHaveCount(2);
            await page.evaluate(() => {
                const w = window.dashboardInstance.widgets.find((x) => x.id === 'w_notes_e2e');
                w.config = { ...w.config, text: 'new first line\n[ ] close port 8443\n[ ] replace disk' };
            });
            await tile.locator('input[type="checkbox"]').nth(1).check();
            await expect.poll(() => storedText(page, pageId))
                .toBe('new first line\n[ ] close port 8443\n[x] replace disk');
        } finally {
            await removeNotes(page, pageId);
        }
    });

    test('Edit opens a textarea; Ctrl+Enter saves and Escape cancels', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, '');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            const tile = page.locator('.dashboard-widget[data-widget-id="w_notes_e2e"]');
            await tile.locator('.dashboard-widget-note-edit').click();
            const area = tile.locator('textarea');
            await area.fill('[ ] first\nsecond');
            await area.press('Control+Enter');
            await expect.poll(() => storedText(page, pageId)).toBe('[ ] first\nsecond');
            await expect(tile.locator('input[type="checkbox"]')).toHaveCount(1);

            await tile.locator('.dashboard-widget-note-edit').click();
            await tile.locator('textarea').fill('thrown away');
            await tile.locator('textarea').press('Escape');
            await expect(tile.locator('textarea')).toHaveCount(0);
            expect(await storedText(page, pageId)).toBe('[ ] first\nsecond');
        } finally {
            await removeNotes(page, pageId);
        }
    });

    test('a note of 5000 characters is stored whole', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, 'x'.repeat(5000));
        try {
            expect((await storedText(page, pageId))?.length).toBe(5000);
        } finally {
            await removeNotes(page, pageId);
        }
    });

    test('the editor allows 6000 characters', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, 'hello');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            await page.locator('.dashboard-widget-note-edit').click();
            expect(await page.locator('.dashboard-widget-note-area').getAttribute('maxlength')).toBe('6000');
        } finally {
            await removeNotes(page, pageId);
        }
    });

    test.describe('the browser markdown engine', () => {
        test('it matches every shared fixture', async ({ page }) => {
            await open(page);
            const results = await page.evaluate((cases) => cases.map((c) => ({
                name: c.name,
                blocks: JSON.parse(JSON.stringify(window.NotesMarkdown.parse(c.text))),
                stats: window.NotesMarkdown.stats(c.text),
            })), markdownCases);
            results.forEach((got, i) => {
                expect(got.blocks, markdownCases[i].name).toEqual(markdownCases[i].blocks);
                expect(got.stats, markdownCases[i].name).toEqual(markdownCases[i].stats);
            });
        });

        test('render builds elements without script-capable markup', async ({ page }) => {
            await open(page);
            const out = await page.evaluate(() => {
                const text = '<img src=x onerror=window.__pwned=1>\n[bad](javascript:window.__pwned=1)\n[net](//evil.test)';
                const host = document.createElement('div');
                host.appendChild(window.NotesMarkdown.render(window.NotesMarkdown.parse(text), {}));
                document.body.appendChild(host);
                return { imgs: host.querySelectorAll('img').length, links: host.querySelectorAll('a').length, pwned: window.__pwned === 1, text: host.textContent };
            });
            expect(out.imgs).toBe(0);
            expect(out.links).toBe(0);
            expect(out.pwned).toBe(false);
            expect(out.text).toContain('<img src=x onerror=window.__pwned=1>');
        });

        test('render draws each block type', async ({ page }) => {
            await open(page);
            const counts = await page.evaluate(() => {
                const md = '# H\n- a\n- b\n> q\n```\nc\n```\n| x |\n| --- |\n| 1 |\n[ ] t\n[bold](/x) **b**';
                const host = document.createElement('div');
                host.appendChild(window.NotesMarkdown.render(window.NotesMarkdown.parse(md), {}));
                const q = (s) => host.querySelectorAll(s).length;
                return { h: q('.dashboard-widget-note-h1'), li: q('li'), quote: q('blockquote'), pre: q('pre'), th: q('th'), td: q('td'), task: q('.dashboard-widget-note-task input'), a: q('a'), strong: q('strong') };
            });
            expect(counts).toEqual({ h: 1, li: 2, quote: 1, pre: 1, th: 1, td: 1, task: 1, a: 1, strong: 1 });
        });
    });

    test.describe('the browser edit engine', () => {
        test('it matches every shared command fixture', async ({ page }) => {
            await open(page);
            const results = await page.evaluate((cases) => cases.map((c) => {
                const cmd = window.NotesSlash.COMMANDS.find((x) => x.name === c.command);
                return cmd ? cmd.run({ ...c.state }, c.max || 6000) : 'missing';
            }), commandCases);
            results.forEach((got, i) => {
                expect(got, commandCases[i].name).toEqual(commandCases[i].expect);
            });
        });

        test('NotesEngine uses the server by default and the browser when told', async ({ page }) => {
            await open(page);
            const requests = [];
            page.on('request', (r) => { if (r.url().includes('/api/widgets/notes/')) requests.push(r.url()); });
            const server = await page.evaluate(async () => {
                window.dashboardInstance.settings.notesProcessing = 'server';
                const out = await window.NotesEngine.render(window.dashboardInstance, '# server');
                const cmd = await window.NotesEngine.command(window.dashboardInstance, 'upper', { value: 'a', start: 0, end: 1 }, 6000);
                return { blocks: out.blocks.length, cmd };
            });
            expect(server.blocks).toBe(1);
            expect(server.cmd).toEqual({ value: 'A', start: 0, end: 1 });
            expect(requests.length).toBe(2);
            requests.length = 0;
            const client = await page.evaluate(async () => {
                window.dashboardInstance.settings.notesProcessing = 'client';
                const out = await window.NotesEngine.render(window.dashboardInstance, '# local');
                const cmd = await window.NotesEngine.command(window.dashboardInstance, 'upper', { value: 'a', start: 0, end: 1 }, 6000);
                window.dashboardInstance.settings.notesProcessing = 'server';
                return { blocks: out.blocks.length, cmd };
            });
            expect(client.blocks).toBe(1);
            expect(client.cmd).toEqual({ value: 'A', start: 0, end: 1 });
            expect(requests.length).toBe(0);
        });

        test('the server reports a full note as null', async ({ page }) => {
            await open(page);
            const full = await page.evaluate(() => window.NotesEngine.command(window.dashboardInstance, 'table',
                { value: 'a'.repeat(6000), start: 0, end: 0 }, 6000));
            expect(full).toBeNull();
        });

        test('/uuid and /date on the server', async ({ page }) => {
            await open(page);
            const out = await page.evaluate(async () => {
                const d = window.dashboardInstance;
                const uuid = await window.NotesEngine.command(d, 'uuid', { value: '', start: 0, end: 0 }, 6000);
                const date = await window.NotesEngine.command(d, 'date', { value: '', start: 0, end: 0 }, 6000);
                return { uuid: uuid.value, date: date.value, local: new Date().toLocaleDateString('sv-SE') };
            });
            expect(out.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(out.date).toBe(out.local);
        });
    });

    test.describe('markdown in the widget', () => {
        test('renders a heading, bold and a list; ticking still saves the line', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '# Plan\n**bold** and `code`\n- a\n- b\n[ ] ship');
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            const widget = page.locator('.dashboard-widget-panel', { hasText: 'Plan' });
            await expect(widget.locator('.dashboard-widget-note-h1')).toHaveText('Plan');
            await expect(widget.locator('strong')).toHaveText('bold');
            await expect(widget.locator('li')).toHaveCount(2);
            await widget.locator('.dashboard-widget-note-task input').check();
            await expect.poll(() => storedText(page, pageId)).toBe('# Plan\n**bold** and `code`\n- a\n- b\n[x] ship');
            await removeNotes(page, pageId);
        });

        test('the server draws it by default and the browser draws it when asked', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '# Where\ntext');
            const requests = [];
            page.on('request', (r) => { if (r.url().includes('/api/widgets/notes/render')) requests.push(r.url()); });
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            await expect(page.locator('.dashboard-widget-note-h1')).toHaveText('Where');
            expect(requests.length).toBeGreaterThan(0);
            requests.length = 0;
            // Switch to the browser, then redraw the tile the way a user does:
            // Edit, then Escape.
            await page.evaluate(() => { window.dashboardInstance.settings.notesProcessing = 'client'; });
            await page.locator('.dashboard-widget-note-edit').click();
            await page.locator('.dashboard-widget-note-area').press('Escape');
            await expect(page.locator('.dashboard-widget-note-h1')).toHaveText('Where');
            expect(requests.length).toBe(0);
            await page.evaluate(() => { window.dashboardInstance.settings.notesProcessing = 'server'; });
            await removeNotes(page, pageId);
        });

        test('a server failure shows plain text and says so', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '# Plain\n[ ] a');
            await page.route('**/api/widgets/notes/render', (route) => route.abort());
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            const widget = page.locator('.dashboard-widget-panel', { hasText: 'Plain' });
            await expect(widget.locator('.dashboard-widget-note-hint')).toContainText('plain text');
            await expect(widget.locator('.dashboard-widget-note-task')).toHaveCount(0);
            await expect(widget).toContainText('# Plain');
            await removeNotes(page, pageId);
        });

        test('two columns show more than one column does', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '[ ] a\n[x] b\nline');
            const stats = () => page.locator('.dashboard-widget-note-stats').first();
            await setNotesColumns(page, pageId, 2);
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            await expect(stats()).toBeVisible();
            await expect(stats()).toContainText('1 of 2 tasks');
            await setNotesColumns(page, pageId, 1);
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            await expect(stats()).toBeHidden();
            await removeNotes(page, pageId);
        });
    });

    test.describe('slash commands in the editor', () => {
        async function editor(page, pageId) {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            await page.locator('.dashboard-widget-note-edit').click();
            return page.locator('.dashboard-widget-note-area');
        }

        test('typing / opens a menu, the keys choose, Escape closes only the menu', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '');
            const area = await editor(page, pageId);
            await area.pressSequentially('/up');
            const menu = page.locator('.notes-slash-menu');
            await expect(menu).toBeVisible();
            await expect(menu.locator('[role=option]')).toHaveCount(1);
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(area).toBeVisible();
            await removeNotes(page, pageId);
        });

        test('/upper, /h1, /todo and /uuid change the text', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '');
            const area = await editor(page, pageId);
            await area.pressSequentially('hello /upp');
            await page.keyboard.press('Enter');
            await expect(area).toHaveValue('HELLO ');
            await area.fill('');
            await area.pressSequentially('/h1');
            await page.keyboard.press('Enter');
            await expect(area).toHaveValue('# ');
            await area.fill('');
            await area.pressSequentially('/todo');
            await page.keyboard.press('Enter');
            await expect(area).toHaveValue('[ ] ');
            await area.fill('');
            await area.pressSequentially('/uuid');
            await page.keyboard.press('Enter');
            await expect(area).toHaveValue(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            await removeNotes(page, pageId);
        });

        test('a command that would overflow the note says so', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '');
            const area = await editor(page, pageId);
            await area.evaluate((el) => { el.value = 'a'.repeat(5995); });
            await area.pressSequentially('\n/table');
            await page.keyboard.press('Enter');
            await expect(page.locator('.dashboard-widget-note-hint')).toContainText('Note full');
            await removeNotes(page, pageId);
        });

        test('the browser setting needs no request', async ({ page }) => {
            await open(page);
            const pageId = await addNotes(page, '');
            const area = await editor(page, pageId);
            await page.evaluate(() => { window.dashboardInstance.settings.notesProcessing = 'client'; });
            const requests = [];
            page.on('request', (r) => { if (r.url().includes('/api/widgets/notes/')) requests.push(r.url()); });
            await area.pressSequentially('/todo');
            await page.keyboard.press('Enter');
            await expect(area).toHaveValue('[ ] ');
            expect(requests.length).toBe(0);
            await page.evaluate(() => { window.dashboardInstance.settings.notesProcessing = 'server'; });
            await removeNotes(page, pageId);
        });
    });

    test.describe('the notes modal', () => {
        async function openModal(page, text) {
            const pageId = await addNotes(page, text);
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0);
            await page.locator('.dashboard-widget-note-expand').click();
            return pageId;
        }

        test('opens from the widget, edits with the toolbar, and stays in sync', async ({ page }) => {
            await open(page);
            const pageId = await openModal(page, 'start');
            const modal = page.locator('.notes-modal-overlay');
            await expect(modal).toBeVisible();
            const area = modal.locator('textarea');
            await expect(area).toHaveValue('start');
            await area.evaluate((el) => { el.setSelectionRange(el.value.length, el.value.length); });
            await area.press('Enter');
            await modal.getByRole('button', { name: 'Task' }).click();
            await expect(area).toHaveValue('start\n[ ] ');
            await area.pressSequentially('ship it');
            await expect(modal.locator('.notes-modal-preview .dashboard-widget-note-task')).toHaveCount(1);
            await expect(modal.locator('.notes-modal-count')).toContainText('/ 6,000');
            await expect.poll(() => storedText(page, pageId)).toBe('start\n[ ] ship it');
            await page.keyboard.press('Escape');
            await expect(modal).toBeHidden();
            await expect(page.locator('.dashboard-widget-note-task').first()).toBeVisible();
            await removeNotes(page, pageId);
        });

        test('Escape closes the slash menu first, then the modal', async ({ page }) => {
            await open(page);
            const pageId = await openModal(page, '');
            const modal = page.locator('.notes-modal-overlay');
            await modal.locator('textarea').pressSequentially('/d');
            await expect(modal.locator('.notes-slash-menu')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(modal.locator('.notes-slash-menu')).toBeHidden();
            await expect(modal).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(modal).toBeHidden();
            await removeNotes(page, pageId);
        });

        test('it locks page scroll while open and releases it after', async ({ page }) => {
            await open(page);
            const pageId = await openModal(page, 'x');
            expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
            await removeNotes(page, pageId);
        });

        test('a toolbar answer that arrives after more typing is dropped', async ({ page }) => {
            await open(page);
            const pageId = await openModal(page, 'a');
            const modal = page.locator('.notes-modal-overlay');
            await page.route('**/api/widgets/notes/command', async (route) => {
                await new Promise((r) => setTimeout(r, 400));
                await route.continue();
            });
            await modal.getByRole('button', { name: 'Bold' }).click();
            await modal.locator('textarea').pressSequentially('zz');
            await page.waitForTimeout(700);
            expect(await modal.locator('textarea').inputValue()).toContain('zz');
            await removeNotes(page, pageId);
        });

        test('phone width shows Edit and Preview tabs', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 800 });
            await open(page);
            const pageId = await openModal(page, '# Hi');
            const modal = page.locator('.notes-modal-overlay');
            await expect(modal.locator('.notes-modal-preview')).toBeHidden();
            await modal.getByRole('button', { name: 'Preview' }).click();
            await expect(modal.locator('.notes-modal-preview')).toBeVisible();
            await removeNotes(page, pageId);
        });
    });
});
