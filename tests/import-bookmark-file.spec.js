// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Importing an exported bookmark file, through the screen.
 *
 * The file used to be read here, by DOMParser, and posted as {name, url,
 * category} — so an export carrying tags, notes and dates arrived stripped to
 * three fields. The parser is in Go now and the browser posts the file itself;
 * these assertions are the fields that used to be lost between the two.
 *
 * The count in the confirm comes from a dry run against that same parser, so
 * the number agreed to is the number that will be written.
 */

const FILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><A HREF="https://e2e-import.example.com/one" ADD_DATE="1610000000" TAGS="Go, weekly">First</A>
    <DD>A note from the file
    <DT><A HREF="https://e2e-import.example.com/two" TOREAD="1">Second</A>
  </DL><p>
  <DT><A HREF="javascript:void(0)">skip me</A>
</DL><p>`;

async function openBackups(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.waitForSelector('#config-browser-import-input', { timeout: 15_000, state: 'attached' });
    // Import and export live inside a collapsed <details>, which is right for a
    // screen someone came to on purpose and means the buttons are not clickable
    // until it is open. These tests are about what the buttons do.
    await page.evaluate(() => {
        document.querySelectorAll('details[data-fold]').forEach((d) => { d.open = true; });
    });
}

async function chooseFile(page) {
    await page.setInputFiles('#config-browser-import-input', {
        name: 'bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(FILE),
    });
    const modal = page.locator('#config-confirm-modal');
    await modal.waitFor({ timeout: 10_000 });
    return modal;
}

test.describe('importing a bookmark file', () => {
    test('keeps the tags, the note and the date the file carried', async ({ page }) => {
        await openBackups(page);
        const modal = await chooseFile(page);

        // Two, not three: the javascript: row is not a bookmark, and the count
        // is the server's — the same parse that is about to do the writing.
        await expect(modal).toContainText('2');
        await modal.locator('[data-confirm="ok"]').click();

        await expect.poll(async () => page.evaluate(async () => {
            const rows = await (await fetch('/api/bookmarks?page=1')).json();
            return rows.filter((b) => b.url.includes('e2e-import')).length;
        }), { timeout: 15_000 }).toBe(2);

        const stored = await page.evaluate(async () => {
            const rows = await (await fetch('/api/bookmarks?page=1')).json();
            const byUrl = {};
            for (const b of rows) byUrl[b.url] = b;
            return byUrl;
        });

        const first = stored['https://e2e-import.example.com/one'];
        expect(first.tags).toEqual(['go', 'weekly']);
        expect(first.note).toBe('A note from the file');
        // ADD_DATE is unix seconds; nextDash keeps milliseconds.
        expect(first.createdAt).toBe(1610000000 * 1000);
        // The folder became a category on the page.
        expect(first.category).toBe('reading');

        // No read state in nextDash, so TOREAD becomes a tag rather than a
        // field invented for one importer.
        expect(stored['https://e2e-import.example.com/two'].tags).toEqual(['toread']);

        // A bookmarklet in the file must not be stored, and must not fail the
        // import of everything around it.
        expect(stored['javascript:void(0)']).toBeUndefined();
    });

    /*
     * Export is half of why the parser moved to Go: a local-first project that
     * cannot hand its collection back in a standard format is asking for trust
     * it has not earned. The proof is that what comes out goes back in.
     */
    test('exports a file the import can read again', async ({ page }) => {
        await openBackups(page);
        await (await chooseFile(page)).locator('[data-confirm="ok"]').click();
        await expect.poll(async () => page.evaluate(async () => {
            const rows = await (await fetch('/api/bookmarks?page=1')).json();
            return rows.filter((b) => b.url.includes('e2e-import')).length;
        }), { timeout: 15_000 }).toBe(2);

        const download = page.waitForEvent('download', { timeout: 15_000 });
        await page.click('[data-backup-action="html-export"]');
        const file = await download;
        expect(file.suggestedFilename()).toMatch(/^nextdash-bookmarks-\d{4}-\d{2}-\d{2}\.html$/);

        const fs = require('fs');
        const body = fs.readFileSync(await file.path(), 'utf8');
        expect(body).toContain('NETSCAPE-Bookmark-file-1');
        // The row that was imported comes back out with what it arrived with.
        expect(body).toContain('https://e2e-import.example.com/one');
        expect(body).toContain('ADD_DATE="1610000000"');
        expect(body).toContain('TAGS="go,weekly"');
        expect(body).toContain('A note from the file');

        // And the server can read its own output: this is the round trip that
        // makes the writer trustworthy rather than merely plausible.
        const reread = await page.evaluate(async (html) => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await f('/api/bookmarks/import-html?page=1&dryRun=1', { method: 'POST', body: html });
            return res.json();
        }, body);
        // Everything in the file is already on the page, which is exactly what
        // a faithful export of that page should say.
        expect(reread.new).toBe(0);
        expect(reread.duplicates).toBeGreaterThanOrEqual(2);
    });

    test('the confirm says how many are already here', async ({ page }) => {
        await openBackups(page);
        await (await chooseFile(page)).locator('[data-confirm="ok"]').click();
        await expect.poll(async () => page.evaluate(async () => {
            const rows = await (await fetch('/api/bookmarks?page=1')).json();
            return rows.filter((b) => b.url.includes('e2e-import')).length;
        }), { timeout: 15_000 }).toBe(2);

        // Second time round, the same file is entirely duplicates — and the
        // question has to say so rather than offering to import two again.
        const modal = await chooseFile(page);
        await expect(modal).toContainText(/already/i);
        await expect(modal).toContainText('2');
        await modal.locator('[data-confirm="cancel"]').click();
    });
});
