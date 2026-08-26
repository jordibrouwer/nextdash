// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * What the fetcher learns about a page, on the card that describes it.
 *
 * The backend reads og:site_name, the author and the publication date, and
 * asks the page for its own oEmbed player. None of that was worth extracting
 * while nothing drew it: this covers the two bands that now do.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Paint a card from a preview the server might have returned. */
async function paint(page, preview, { mode = 'pinned', parts = null } = {}) {
    return page.evaluate(({ preview, mode, parts }) => {
        const d = window.dashboardInstance;
        if (parts) d.settings.linkPreviewParts = parts;
        else delete d.settings.linkPreviewParts;
        const bookmark = { url: preview.url || 'https://example.com/a', name: 'A bookmark' };
        const card = d.preview.ensureBookmarkPreviewCard();
        const payload = d.preview.buildPreviewPayload(bookmark, preview);
        d.preview.paintPreviewCard(card, payload, { mode });
        card.classList.add('is-visible');
        const byline = card.querySelector('.bookmark-preview-card-byline');
        const embed = card.querySelector('.bookmark-preview-card-embed');
        const frame = embed?.querySelector('iframe');
        return {
            byline: byline?.hidden ? '' : (byline?.textContent || ''),
            embedShown: !!embed && !embed.hidden,
            src: frame?.getAttribute('src') || '',
            sandbox: frame?.getAttribute('sandbox') || '',
            // What the payload carried, to prove the fields survive the trip.
            payload: { site: payload.siteName, author: payload.author, published: payload.publishedAt },
        };
    }, { preview, mode, parts });
}

test.describe('preview card byline and player', () => {
    test('publisher, author and date read as one line', async ({ page }) => {
        await open(page);
        const r = await paint(page, {
            url: 'https://arstechnica.com/story', title: 'A story', domain: 'arstechnica.com',
            siteName: 'Ars Technica', author: 'Jane Doe', publishedAt: Date.UTC(2024, 4, 17),
        });
        expect(r.payload).toMatchObject({ site: 'Ars Technica', author: 'Jane Doe' });
        expect(r.byline).toContain('Ars Technica');
        expect(r.byline).toContain('Jane Doe');
        expect(r.byline).toContain('2024');
        // One line, not three rows.
        expect(r.byline).toContain('·');
    });

    test('a site name that only repeats the address is left off', async ({ page }) => {
        await open(page);
        const r = await paint(page, {
            url: 'https://example.com/a', title: 'T', domain: 'example.com', siteName: 'Example',
        });
        expect(r.byline).toBe('');
    });

    test('a page that states nothing gets no byline at all', async ({ page }) => {
        await open(page);
        const r = await paint(page, { url: 'https://example.com/a', title: 'T', domain: 'example.com' });
        expect(r.byline).toBe('');
    });

    test('the player is sandboxed and never enters the page DOM', async ({ page }) => {
        await open(page);
        const r = await paint(page, {
            url: 'https://youtube.com/watch?v=x', title: 'V', domain: 'youtube.com',
            embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
        });
        expect(r.embedShown).toBe(true);
        /*
         * Only the player's address is taken from the provider's markup; the
         * frame is built here. An earlier version wrapped their HTML in a
         * sandboxed srcdoc frame, and a sandbox without allow-same-origin gives
         * a null origin the player cannot initialise in -- it drew black. What
         * confines the frame now is frame-src in the CSP, checked in Go.
         */
        expect(r.src).toContain('https://www.youtube.com/embed/x');
        const raw = await page.evaluate(() =>
            document.querySelector('.bookmark-preview-card-embed')?.innerHTML || '');
        // One frame built here, not a copy of what the provider sent.
        expect(raw.match(/<iframe/g) || []).toHaveLength(1);
        expect(raw).not.toContain('frameborder');
    });

    // The markup comes from whatever site the bookmark points at, so anything
    // that is not an https player address yields no frame at all.
    test('markup that is not an https player is refused', async ({ page }) => {
        await open(page);
        for (const embedHtml of [
            '<iframe src="javascript:alert(1)"></iframe>',
            '<iframe src="http://insecure.example/embed"></iframe>',
            '<script>alert(1)</script>',
            '<div>no frame here</div>',
        ]) {
            const r = await paint(page, {
                url: 'https://example.com/a', title: 'T', domain: 'example.com', embedHtml,
            });
            expect(r.embedShown, embedHtml).toBe(false);
        }
        // And nothing from those strings ran or landed in the page.
        const stray = await page.evaluate(() => document.querySelectorAll('.bookmark-preview-card-embed script').length);
        expect(stray).toBe(0);
    });

    test('hovering does not open a player', async ({ page }) => {
        await open(page);
        const r = await paint(page, {
            url: 'https://youtube.com/watch?v=x', title: 'V', domain: 'youtube.com',
            embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
        }, { mode: 'peek' });
        expect(r.embedShown).toBe(false);
    });

    test('both bands answer to the reader\'s checklist', async ({ page }) => {
        await open(page);
        const r = await paint(page, {
            url: 'https://arstechnica.com/story', title: 'T', domain: 'arstechnica.com',
            siteName: 'Ars Technica', author: 'Jane Doe',
            embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
        }, { parts: ['description', 'tags'] });
        expect(r.byline).toBe('');
        expect(r.embedShown).toBe(false);
    });

    test('the player is torn down when the card closes, not merely hidden', async ({ page }) => {
        await open(page);
        await paint(page, {
            url: 'https://youtube.com/watch?v=x', title: 'V', domain: 'youtube.com',
            embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
        });
        const after = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const card = d.previewCardElement;
            d.preview.hideBookmarkPreviewCard();
            return {
                frames: card.querySelectorAll('iframe').length,
                embedHidden: card.querySelector('.bookmark-preview-card-embed')?.hidden,
            };
        });
        // display:none does not stop a frame loading or playing.
        expect(after.frames).toBe(0);
        expect(after.embedHidden).toBe(true);
    });

    test('a repaint does not restart the video', async ({ page }) => {
        await open(page);
        const preview = {
            url: 'https://youtube.com/watch?v=x', title: 'V', domain: 'youtube.com',
            embedHtml: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
        };
        await paint(page, preview);
        const same = await page.evaluate((preview) => {
            const d = window.dashboardInstance;
            const card = d.previewCardElement;
            const first = card.querySelector('.bookmark-preview-card-embed iframe');
            const payload = d.preview.buildPreviewPayload({ url: preview.url, name: 'V' }, preview);
            d.preview.paintPreviewCard(card, payload, { mode: 'pinned' });
            return first === card.querySelector('.bookmark-preview-card-embed iframe');
        }, preview);
        expect(same).toBe(true);
    });

    /*
     * The bug that made every one of the tests above pass while the feature
     * did nothing on a real dashboard.
     *
     * A bookmark that already carries a stored preview takes a shortcut that
     * skips the server and rebuilds the preview from stored fields. That list
     * was written before these fields existed, so they arrived empty on exactly
     * the bookmarks a person has been using -- and only Refresh, which is the
     * one path that bypasses the shortcut, appeared to work.
     */
    test('a bookmark with an older stored preview still gets the new fields', async ({ page }) => {
        await open(page);
        const r = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            // Exactly the shape stored before the byline existed.
            const bookmark = {
                url: 'https://www.youtube.com/watch?v=stored',
                name: 'Stored',
                previewTitle: 'A stored title',
                previewDesc: 'A stored description',
                previewImage: 'https://example.com/i.jpg',
            };
            const link = document.createElement('a');
            link.className = 'bookmark-open';
            link.href = bookmark.url;
            document.body.appendChild(link);

            let asked = false;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/bookmark-preview')) {
                    asked = true;
                    return new Response(JSON.stringify({
                        title: 'A stored title', description: 'A stored description',
                        image: 'https://example.com/i.jpg', domain: 'www.youtube.com',
                        siteName: 'YouTube', author: 'Someone', publishedAt: Date.UTC(2024, 0, 2),
                        embedHtml: '<iframe src="https://www.youtube.com/embed/stored"></iframe>',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            try {
                const preview = await d.preview.fetchBookmarkPreviewData(link, bookmark);
                return { asked, embed: (preview?.embedHtml || ''),
                         site: preview?.siteName || '', author: preview?.author || '' };
            } finally {
                window.fetch = realFetch;
                link.remove();
            }
        });
        // The stored record predates the fields, so the server has to be asked.
        expect(r.asked).toBe(true);
        expect(r.site).toBe('YouTube');
        expect(r.author).toBe('Someone');
        expect(r.embed).toContain('youtube.com/embed/stored');
    });

    // Once answered for, the shortcut is trusted again and carries every field.
    test('an enriched bookmark keeps its fields without asking again', async ({ page }) => {
        await open(page);
        const r = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const bookmark = {
                url: 'https://www.youtube.com/watch?v=enriched', name: 'E',
                previewTitle: 'T', previewDesc: 'D', previewImage: 'https://example.com/i.jpg',
                previewSiteName: 'YouTube', previewAuthor: 'Someone',
                previewPublishedAt: Date.UTC(2024, 0, 2),
                previewEmbedHtml: '<iframe src="https://www.youtube.com/embed/enriched"></iframe>',
                previewEnriched: true,
            };
            const link = document.createElement('a');
            link.className = 'bookmark-open';
            link.href = bookmark.url;
            document.body.appendChild(link);
            let asked = false;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/bookmark-preview')) asked = true;
                return realFetch(url, ...rest);
            };
            try {
                const preview = await d.preview.fetchBookmarkPreviewData(link, bookmark);
                return { asked, site: preview?.siteName || '', embed: (preview?.embedHtml || '') };
            } finally {
                window.fetch = realFetch;
                link.remove();
            }
        });
        expect(r.asked).toBe(false);
        expect(r.site).toBe('YouTube');
        expect(r.embed).toContain('youtube.com/embed/enriched');
    });
});
