// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A bookmark that is a video says so, and plays where it is.
 *
 * The mark is read from the address, so a row carries it the moment the grid
 * draws — no preview, no request. The card's play button is the same question
 * asked again: a poster over the picture the card already holds, and nothing
 * reaches the provider until it is pressed.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('video bookmarks', () => {
    test('the address alone decides what counts as a video', async ({ page }) => {
        await openDashboard(page);

        const verdicts = await page.evaluate(() => {
            const is = (url) => window.VideoLinks.isVideoLink(url);
            const src = (url) => window.VideoLinks.videoEmbedSource(url);
            return {
                watch: is('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
                short: is('https://youtu.be/dQw4w9WgXcQ'),
                shorts: is('https://www.youtube.com/shorts/abc123'),
                vimeo: is('https://vimeo.com/76979871'),
                file: is('https://media.example.com/clips/demo.mp4'),
                // A channel is not a video, and neither is an ordinary page.
                channel: is('https://www.youtube.com/@nextdash'),
                vimeoChannel: is('https://vimeo.com/channels/staff'),
                article: is('https://news.ycombinator.com'),
                // The player's address never leaves the hosts frame-src admits.
                watchSource: src('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
                vimeoSource: src('https://vimeo.com/76979871'),
                channelSource: src('https://www.youtube.com/@nextdash'),
            };
        });

        expect(verdicts.watch).toBe(true);
        expect(verdicts.short).toBe(true);
        expect(verdicts.shorts).toBe(true);
        expect(verdicts.vimeo).toBe(true);
        expect(verdicts.file).toBe(true);
        expect(verdicts.channel).toBe(false);
        expect(verdicts.vimeoChannel).toBe(false);
        expect(verdicts.article).toBe(false);
        expect(verdicts.watchSource).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
        expect(verdicts.vimeoSource).toBe('https://player.vimeo.com/video/76979871');
        expect(verdicts.channelSource).toBe('');
    });

    /*
     * The mark is on the row itself: a reader scanning a page of links should
     * be able to tell which ones are going to start talking, before opening
     * anything.
     */
    test('a video row carries the play mark and an ordinary row does not', async ({ page }) => {
        await openDashboard(page);

        const stamp = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const add = (bookmark) => api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark }),
            });
            const mark = Date.now();
            await add({ name: `Video row ${mark}`, url: `https://www.youtube.com/watch?v=vid${mark}`, category: '' });
            await add({ name: `Plain row ${mark}`, url: `https://plain-${mark}.example/page`, category: '' });
            return mark;
        });

        // Reloaded rather than repainted: the grid draws from the list the page
        // loaded with, and a row added behind its back is not in it.
        await openDashboard(page);

        const marks = await page.evaluate((mark) => {
            const row = (name) => [...document.querySelectorAll('.bookmark-link')]
                .find((el) => el.textContent.includes(name));
            return {
                found: !!row(`Video row ${mark}`) && !!row(`Plain row ${mark}`),
                video: !!row(`Video row ${mark}`)?.querySelector('.bookmark-video-badge'),
                plain: !!row(`Plain row ${mark}`)?.querySelector('.bookmark-video-badge'),
            };
        }, stamp);

        expect(marks.found).toBe(true);

        expect(marks.video).toBe(true);
        expect(marks.plain).toBe(false);
    });

    /*
     * The poster is the promise this makes: a play button on a hover card, and
     * no frame — so the dashboard is not talking to the provider because a
     * pointer crossed a link. The frame appears when the button is pressed,
     * and the card stays put so a moving hand cannot stop the video.
     */
    test('the hover card offers a poster, and the click makes the player', async ({ page }) => {
        await openDashboard(page);

        const drawn = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const preview = {
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                title: 'A video',
                image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
                description: '',
            };
            const bookmark = { url: preview.url, name: 'A video', tags: [] };
            d.showBookmarkPreviewCard(
                d.preview.buildPreviewPayload(bookmark, preview), null, { mode: 'peek' });
            const card = d.previewCardElement;
            const before = {
                poster: !!card.querySelector('.bookmark-preview-card-poster'),
                frame: !!card.querySelector('iframe'),
                mode: card.dataset.previewMode,
                imageBand: !card.querySelector('.bookmark-preview-card-image-wrap')?.hidden,
            };
            card.querySelector('.bookmark-preview-card-poster').click();
            await new Promise((resolve) => setTimeout(resolve, 200));
            const frame = card.querySelector('iframe');
            return {
                before,
                frameSrc: frame ? frame.getAttribute('src') : '',
                posterGone: !card.querySelector('.bookmark-preview-card-poster'),
                mode: card.dataset.previewMode,
                imageBand: !card.querySelector('.bookmark-preview-card-image-wrap')?.hidden,
            };
        });

        expect(drawn.before.poster).toBe(true);
        expect(drawn.before.frame).toBe(false);
        // One picture on the card: the poster is that picture, so the band
        // underneath would be the same frame drawn twice.
        expect(drawn.before.imageBand).toBe(false);
        expect(drawn.before.mode).toBe('peek');
        expect(drawn.frameSrc).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
        expect(drawn.frameSrc).toContain('autoplay=1');
        expect(drawn.posterGone).toBe(true);
        // And still one picture: the player replaced the poster, nothing came back.
        expect(drawn.imageBand).toBe(false);
        // Pressing play asked for the card, so it stays until Escape.
        expect(drawn.mode).toBe('pinned');
    });

    /*
     * A page that is not a video gets no play button.
     *
     * The poster asked only where a player might be, and took any answer. Two
     * ways to get one for a page with no video: markup that carries a frame
     * which is not a player, and — on a dashboard served over https — no
     * markup at all, because '' resolved against the page's own address is
     * the dashboard's URL, which is https and so passed for a player. Every
     * hover card drew a black rectangle with a play button on it.
     *
     * So the question is asked of the bookmark's address first: a page that is
     * not a video has no poster, whatever its oEmbed says.
     */
    test('a card for an ordinary page has no poster', async ({ page }) => {
        await openDashboard(page);

        const drawn = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const preview = {
                url: 'https://start.1password.com/signin',
                title: '1Password',
                image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
                description: 'A password manager.',
                // A provider is free to hand out a frame that plays nothing.
                embedHtml: '<iframe src="https://start.1password.com/embedded"></iframe>',
            };
            const bookmark = { url: preview.url, name: '1Password', tags: [] };
            d.showBookmarkPreviewCard(
                d.preview.buildPreviewPayload(bookmark, preview), null, { mode: 'peek' });
            const card = d.previewCardElement;
            return {
                poster: !!card.querySelector('.bookmark-preview-card-poster'),
                withFrame: d.preview.videoPlayerSource(preview),
                // And with nothing to go on at all, still nothing.
                bare: d.preview.videoPlayerSource({ url: preview.url }),
                empty: d.preview.embedPlayerSource(''),
            };
        });

        expect(drawn.withFrame).toBe('');
        expect(drawn.bare).toBe('');
        expect(drawn.empty).toBe('');
        expect(drawn.poster).toBe(false);
    });

    /*
     * A preview stored before the server asked for oEmbed carries no
     * embedHtml. The address still knows where the player is, so the card
     * offers one anyway.
     */
    test('a card with no oEmbed still finds the player', async ({ page }) => {
        await openDashboard(page);

        const source = await page.evaluate(() => {
            const d = window.dashboardInstance;
            return d.preview.videoPlayerSource({
                url: 'https://youtu.be/abc12345',
                embedHtml: '',
            });
        });

        expect(source).toBe('https://www.youtube-nocookie.com/embed/abc12345');
    });

    /*
     * The keyboard path: Shift+V asks for the card, and the play button is
     * already under the cursor, so Enter starts the video.
     *
     * Pressed for real, because the grid's own key handler runs in the capture
     * phase: a button that only stops propagation cannot stop it, and Enter
     * both started the video and opened the bookmark in a new tab behind the
     * card. A popup here is the failure.
     */
    test('Shift+V then Enter plays, and does not open the link', async ({ page }) => {
        await openDashboard(page);

        const stamp = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const mark = Date.now();
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: d.currentPageId,
                    bookmark: { name: `Keyboard video ${mark}`, url: `https://www.youtube.com/watch?v=kbd${mark}`, category: '' },
                }),
            });
            return mark;
        });
        await openDashboard(page);

        // The card draws from a preview; this install has none for a made-up
        // video, so the payload is handed over directly with the row selected.
        const popups = [];
        page.on('popup', (p) => popups.push(p.url()));

        // Settle first: a repaint after the load replaces the row elements, and
        // the cursor set on an element that is no longer in the grid points
        // nowhere. Any card left open would make Shift+V a toggle that closes.
        await page.waitForTimeout(800);
        const ready = await page.evaluate((mark) => {
            const d = window.dashboardInstance;
            d.hideBookmarkPreviewCard?.();
            const row = [...document.querySelectorAll('.bookmark-link')]
                .find((el) => el.textContent.includes(`Keyboard video ${mark}`));
            if (!row) return false;
            const link = row.querySelector('a.bookmark-open');
            link.scrollIntoView({ block: 'center' });
            link.focus();
            /*
             * Shift+V acts on the grid's own cursor, not on what the browser
             * happens to have focused, so the cursor is put on this row the
             * way an arrow key would have left it.
             */
            const nav = d.keyboardNavigation;
            const index = (nav?.navigableElements || []).indexOf(row);
            if (nav && index >= 0) nav.currentIndex = index;
            return index >= 0 && document.activeElement === link;
        }, stamp);
        expect(ready).toBe(true);

        await page.keyboard.press('Shift+V');
        await page.waitForTimeout(600);
        const pinned = await page.evaluate(() => ({
            mode: window.dashboardInstance.previewCardElement?.dataset.previewMode || '',
            focused: document.activeElement?.className || '',
        }));
        expect(pinned.mode).toBe('pinned');
        expect(pinned.focused).toContain('bookmark-preview-card-poster');

        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);

        const played = await page.evaluate(() => {
            const card = window.dashboardInstance.previewCardElement;
            return {
                frame: card?.querySelector('iframe')?.getAttribute('src') || '',
                mode: card?.dataset.previewMode || '',
            };
        });
        expect(played.frame).toContain('/embed/');
        expect(played.mode).toBe('pinned');
        // The row behind the card stayed shut.
        expect(popups).toEqual([]);
    });
    /*
     * A way out that does not need the keyboard.
     *
     * A click inside the player hands the keyboard to the provider: Escape
     * then goes to YouTube and this card never hears it. So the player has its
     * own close, and leaving the card takes the focus back off the frame —
     * which is what makes Escape work again.
     */
    test('the player can be closed without the keyboard, and gives the focus back', async ({ page }) => {
        await openDashboard(page);

        const closed = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const preview = {
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                title: 'A video',
                image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            };
            const bookmark = { url: preview.url, name: 'A video', tags: [] };
            d.showBookmarkPreviewCard(
                d.preview.buildPreviewPayload(bookmark, preview), null, { mode: 'pinned' });
            const card = d.previewCardElement;
            card.querySelector('.bookmark-preview-card-poster').click();
            await new Promise((resolve) => setTimeout(resolve, 200));

            const frame = card.querySelector('.bookmark-preview-card-embed-frame');
            // What a click inside the player does: the frame takes the focus.
            frame.focus();
            const heldByFrame = document.activeElement === frame;
            card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
            const backOnCard = document.activeElement === card;

            const closeButton = card.querySelector('.bookmark-preview-card-embed-close');
            closeButton.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            return {
                hadClose: !!closeButton,
                heldByFrame,
                backOnCard,
                visible: card.classList.contains('is-visible'),
                frame: !!card.querySelector('iframe'),
            };
        });

        expect(closed.hadClose).toBe(true);
        expect(closed.heldByFrame).toBe(true);
        expect(closed.backOnCard).toBe(true);
        // Closing tears the player down rather than hiding it: a frame that is
        // merely invisible keeps playing.
        expect(closed.visible).toBe(false);
        expect(closed.frame).toBe(false);
    });
    /*
     * And a click anywhere else closes it, which is the answer for the reader
     * who clicked into the player and now has a provider holding the keyboard.
     */
    test('a click away closes a pinned card and its player', async ({ page }) => {
        await openDashboard(page);

        const gone = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const preview = {
                url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                title: 'A video',
                image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            };
            d.showBookmarkPreviewCard(
                d.preview.buildPreviewPayload({ url: preview.url, name: 'A video' }, preview),
                null, { mode: 'pinned' });
            const card = d.previewCardElement;
            card.querySelector('.bookmark-preview-card-poster').click();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const playing = !!card.querySelector('iframe');

            // A click inside the card leaves it alone...
            card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            const stillThere = card.classList.contains('is-visible');
            // ...and one on the page behind it closes it.
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            return {
                playing,
                stillThere,
                visible: card.classList.contains('is-visible'),
                frame: !!card.querySelector('iframe'),
            };
        });

        expect(gone.playing).toBe(true);
        expect(gone.stillThere).toBe(true);
        expect(gone.visible).toBe(false);
        expect(gone.frame).toBe(false);
    });
});