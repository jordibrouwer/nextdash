// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The card that hovers over a bookmark should be the best answer on the
 * dashboard, and was the least informed thing on it.
 *
 * Seven stacked divs that printed the address twice, hid "never opened"
 * entirely, cut themselves off at 360px without saying so, and chased the
 * cursor while claiming to be reachable. It is three bands now — what it is,
 * what it says, what I know about it — every one of them absent rather than
 * blank, and it holds still beside the row it describes.
 */

async function openDashboard(page, mode = 'hover') {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((m) => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = m;
        d.settings.showLinkPreviewCards = m !== 'off';
        d.settings.linkPreviewHoverDelayMs = 100;
        d.renderDashboard({ animate: false, forceFull: true });
    }, mode);
}

/** The payload the card draws, for a bookmark we control entirely. */
async function paint(page, bookmark, { mode = 'peek', parts = null } = {}) {
    return page.evaluate(({ bookmark, mode, parts }) => {
        const d = window.dashboardInstance;
        if (parts) d.settings.linkPreviewParts = parts;
        else delete d.settings.linkPreviewParts;
        const card = d.preview.ensureBookmarkPreviewCard();
        const payload = d.preview.buildPreviewPayload(bookmark, {
            title: bookmark.previewTitle || bookmark.name,
            description: bookmark.previewDesc || '',
            image: bookmark.previewImage || '',
            url: bookmark.url,
        });
        d.preview.paintPreviewCard(card, payload, { mode });
        card.classList.add('is-visible');
        const shown = (sel) => {
            const el = card.querySelector(sel);
            return el && !el.hidden;
        };
        return {
            facts: [...card.querySelectorAll('.bookmark-preview-card-facts dt')].map((dt) => dt.textContent),
            values: [...card.querySelectorAll('.bookmark-preview-card-facts dd')].map((dd) => dd.textContent),
            note: card.querySelector('.bookmark-preview-card-note-text')?.textContent || '',
            noteShown: shown('.bookmark-preview-card-note'),
            image: shown('.bookmark-preview-card-image-wrap'),
            description: shown('.bookmark-preview-card-description'),
            tags: shown('.bookmark-preview-card-tags'),
            domain: card.querySelector('.bookmark-preview-card-domain')?.textContent || '',
            foot: shown('.bookmark-preview-card-foot'),
            pointerEvents: getComputedStyle(card).pointerEvents,
        };
    }, { bookmark, mode, parts });
}

test.describe('the preview card', () => {
    test('never opened is a row, not a silence', async ({ page }) => {
        await openDashboard(page);
        const drawn = await paint(page, {
            name: 'A book I meant to read', url: 'https://example.org/book', openCount: 0, createdAt: Date.now() - 86400000,
        });
        // The most interesting state a bookmark can be in used to render as
        // nothing at all: `if (openCount > 0)` hid the row.
        expect(drawn.facts.join('|')).toContain('Opens');
        expect(drawn.values.join(' ')).toMatch(/never opened/i);
    });

    test('the address is stated once', async ({ page }) => {
        await openDashboard(page);
        const drawn = await paint(page, { name: 'Docs', url: 'https://go.dev/doc/go1.24', openCount: 2 });
        // It used to print the whole URL in mono and then its hostname on the
        // line below — two of seven rows saying the same thing.
        expect(drawn.domain).toBe('go.dev/doc/go1.24');
        expect(await page.locator('.bookmark-preview-card-url').count()).toBe(0);
    });

    test('a note is a note, not a paragraph in the same grey', async ({ page }) => {
        await openDashboard(page);
        const long = 'x'.repeat(200);
        const drawn = await paint(page, { name: 'N', url: 'https://example.org/', note: long, openCount: 1 });
        expect(drawn.noteShown).toBe(true);
        // Clamped by CSS, which can be undone by making the card wider; the JS
        // cut at 140 characters landed mid-word and could not.
        expect(drawn.note.length).toBe(200);
        expect(drawn.note.endsWith('...')).toBe(false);
    });

    test('a band nobody asked for is absent', async ({ page }) => {
        await openDashboard(page);
        const bookmark = {
            name: 'Everything', url: 'https://example.org/all', note: 'mine', tags: ['a'],
            previewDesc: 'theirs', openCount: 5,
        };
        const all = await paint(page, bookmark);
        expect(all.noteShown).toBe(true);
        expect(all.tags).toBe(true);
        expect(all.description).toBe(true);

        const trimmed = await paint(page, bookmark, { parts: ['description'] });
        expect(trimmed.description).toBe(true);
        expect(trimmed.noteShown).toBe(false);
        expect(trimmed.tags).toBe(false);
        expect(trimmed.facts.length).toBe(0);
    });

    test('a peek has nothing to aim at; a pinned card does', async ({ page }) => {
        await openDashboard(page);
        const peek = await paint(page, { name: 'P', url: 'https://example.org/', openCount: 1 }, { mode: 'peek' });
        expect(peek.foot).toBe(false);
        expect(peek.pointerEvents).toBe('none');

        const pinned = await paint(page, { name: 'P', url: 'https://example.org/', openCount: 1 }, { mode: 'pinned' });
        expect(pinned.foot).toBe(true);
        expect(pinned.pointerEvents).not.toBe('none');
        // A pinned card is a dialog with a name, so it can be found and left.
        expect(await page.locator('#bookmark-preview-card[role="dialog"]').count()).toBe(1);
    });

    test('a dead thumbnail leaves no gap', async ({ page }) => {
        await openDashboard(page);
        await paint(page, {
            name: 'Rotten', url: 'https://example.org/', previewImage: 'https://example.invalid/gone.png', openCount: 1,
        });
        // The image is hot-linked and rots faster than the page; without the
        // error handler the card drew the broken-image glyph in a 150px band.
        await expect.poll(() => page.evaluate(() =>
            document.querySelector('.bookmark-preview-card-image-wrap').hidden), { timeout: 10_000 }).toBe(true);
    });

    test('hovering opens it beside the row, and it stays there', async ({ page }) => {
        await openDashboard(page, 'hover');
        const row = page.locator('.bookmark-link .bookmark-open').first();
        await row.hover();
        const card = page.locator('.bookmark-preview-card.is-visible');
        await expect(card).toBeVisible({ timeout: 10_000 });

        const first = await card.boundingBox();
        // The card used to be repositioned on every pixel of mousemove, so
        // moving toward it moved it away.
        await page.mouse.move(5, 5, { steps: 3 });
        await row.hover();
        await page.waitForTimeout(200);
        const second = await card.boundingBox();
        expect(Math.round(second.x)).toBe(Math.round(first.x));
        expect(Math.round(second.y)).toBe(Math.round(first.y));
    });

    test('keyboard-only means the pointer never opens it', async ({ page }) => {
        await openDashboard(page, 'keyboard');
        await page.locator('.bookmark-link .bookmark-open').first().hover();
        await page.waitForTimeout(400);
        await expect(page.locator('.bookmark-preview-card.is-visible')).toHaveCount(0);

        // ...but the row still has its description for a screen reader, which
        // removing the title used to take away with nothing put back.
        const described = await page.evaluate(() => {
            const link = document.querySelector('.bookmark-link .bookmark-open');
            const id = link?.getAttribute('aria-describedby');
            return { id, text: id ? document.getElementById(id)?.textContent : '' };
        });
        expect(described.id).toBeTruthy();
        expect(String(described.text).length).toBeGreaterThan(0);
    });
});
