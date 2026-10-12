// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/*
 * What's new: the spotlight, the releases a reader missed, the chips and the
 * "Show me" button (static/js/whats-new-modal.js).
 *
 * The release files are this spec's own, served in place of the shipped ones,
 * so the tests do not change with every release's prose.
 */

const VIDEO = fs.readFileSync(path.join(__dirname, '..', 'static', 'data', 'whats-new', 'media', 'v1.19.4-weekly-digest.webm'));
const STILL = fs.readFileSync(path.join(__dirname, '..', 'static', 'data', 'whats-new', 'media', 'v1.19.4-weekly-digest.jpg'));

const RELEASES = {
    'v9.2.0': {
        tag: 'v9.2.0', date: '20 December 2026', releasedAt: '2026-12-20',
        modalLead: 'The <strong>newest</strong> release.',
        sections: [
            { title: 'Alpha', items: [
                { badge: 'new', highlight: true, title: 'A short title',
                    text: '<strong>A long bold lead that says the same thing at length:</strong> and the explanation after it.',
                    link: '#config/monitoring/notifications', linkLabel: 'Set it up',
                    media: { image: 'media/v9.2.0-spot.jpg', video: 'media/v9.2.0-spot.webm', alt: 'The thing' } },
                { badge: 'new', text: '<strong>Another new thing.</strong> More words.' },
                { badge: 'fix', text: '<strong>A fixed thing.</strong> Why.' },
            ] },
            { title: 'Beta', items: [
                { badge: 'new', text: '<strong>Beta new.</strong> Words.' },
            ] },
        ],
    },
    'v9.1.0': {
        tag: 'v9.1.0', date: '18 December 2026', releasedAt: '2026-12-18',
        modalLead: 'The one in between.',
        sections: [
            { title: 'Alpha', items: [{ badge: 'fix', text: '<strong>Alpha fix in between.</strong> Why.' }] },
            { title: 'Gamma', items: [{ badge: 'new', text: '<strong>Gamma new.</strong> Words.',
                media: { image: '../../../etc/passwd.jpg' } }] },
        ],
    },
    'v9.0.0': { tag: 'v9.0.0', date: '10 December 2026', releasedAt: '2026-12-10', sections: [
        { title: 'Alpha', items: [{ badge: 'new', text: '<strong>Old.</strong>' }] }] },
    'v8.0.0': { tag: 'v8.0.0', date: '1 December 2026', releasedAt: '2026-12-01', sections: [
        { title: 'Alpha', items: [{ badge: 'new', text: '<strong>Older.</strong>' }] }] },
};

async function serveReleases(page) {
    const index = Object.values(RELEASES).map(({ tag, date, releasedAt }) => ({ id: tag, tag, date, releasedAt }));
    await page.route('**/static/data/whats-new/**', (route) => {
        const file = new URL(route.request().url()).pathname.split('/static/data/whats-new/')[1];
        if (file === 'index.json') return route.fulfill({ json: index });
        if (file.endsWith('.webm')) return route.fulfill({ body: VIDEO, contentType: 'video/webm' });
        if (file.endsWith('.jpg')) return route.fulfill({ body: STILL, contentType: 'image/jpeg' });
        const release = RELEASES[file.replace(/\.json$/, '')];
        return release ? route.fulfill({ json: release }) : route.fulfill({ status: 404, body: '' });
    });
}

/**
 * The dashboard for a reader who last closed this window on `lastSeen`
 * ('' = never), then the window opened the way the header button opens it.
 */
async function openAs(page, lastSeen) {
    await serveReleases(page);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (token) => {
        // What the server would have hydrated for this reader.
        window.DiscoverabilityState.getLastWhatsNewRelease = () => token;
        try {
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', token);
        } catch { /* storage off */ }
        await window.ensureWhatsNewLoaded?.();
        await window.openWhatsNewModal({ force: true, markSeenOnConfirm: false });
    }, lastSeen ? `2026.12-dashboard-release-${lastSeen}` : '');
    await expect(page.locator('.whats-new-modal [data-wn-content]')).toBeVisible();
}

const modal = (page) => page.locator('.whats-new-modal');

test.describe("what's new: spotlight and catch-up", () => {
    test('every release since the last visit opens, and the line above counts them', async ({ page }) => {
        await openAs(page, 'v9.0.0');
        const rels = modal(page).locator('.wn-rel');
        await expect(rels).toHaveCount(2);
        await expect(rels.nth(0)).toHaveAttribute('data-wn-rel', 'v9.2.0');
        await expect(rels.nth(1)).toHaveAttribute('data-wn-rel', 'v9.1.0');
        await expect(rels.nth(1).locator('.wn-rel-unread')).toBeVisible();
        await expect(modal(page).locator('[data-wn-since]')).toContainText('2 releases');
        await expect(modal(page).locator('[data-wn-since]')).toContainText('4 new and 2 fixed');
        // What is open is not listed again under Earlier.
        const earlier = await modal(page).locator('[data-wn-earlier]').evaluateAll((els) => els.map((el) => el.dataset.wnEarlier));
        expect(earlier).toEqual(['v9.0.0', 'v8.0.0']);
        // The ask comes after everything that is open.
        const after = await page.evaluate(() => {
            const rel = [...document.querySelectorAll('.whats-new-modal .wn-rel')].pop();
            const card = document.querySelector('.whats-new-modal .wn-support');
            return Boolean(rel && card && (rel.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        expect(after).toBe(true);
    });

    test('a browser that never saw the window gets only the newest release', async ({ page }) => {
        await openAs(page, '');
        await expect(modal(page).locator('.wn-rel')).toHaveCount(1);
        await expect(modal(page).locator('[data-wn-since]')).toHaveCount(0);
    });

    test('the highlight is the spotlight, with a short title and its recording', async ({ page }) => {
        await openAs(page, 'v9.1.0');
        const spot = modal(page).locator('.wn-rel--headline .wn-spot');
        await expect(spot).toHaveCount(1);
        await expect(spot.locator('.wn-spot-title')).toHaveText('A short title');
        // The bold lead is what the short title replaces.
        await expect(spot.locator('[data-wn-entry-body]')).not.toContainText('bold lead');
        await expect(spot.locator('[data-wn-entry-body]')).toContainText('the explanation after it');
        const video = spot.locator('video');
        await expect(video).toHaveAttribute('src', /media\/v9\.2\.0-spot\.webm/);
        await expect(video).toHaveAttribute('poster', /media\/v9\.2\.0-spot\.jpg/);
        expect(await video.evaluate((el) => /** @type {HTMLVideoElement} */ (el).muted)).toBe(true);
        // The rest of the new changes are rows under it, not cards beside it.
        await expect(modal(page).locator('.wn-rel--headline .wn-block--new li[data-wn-kind="new"]')).toHaveCount(2);
    });

    test('with motion turned down the spotlight shows the still', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openAs(page, 'v9.1.0');
        const spot = modal(page).locator('.wn-spot');
        await expect(spot.locator('video')).toHaveCount(0);
        await expect(spot.locator('img.wn-media-img')).toHaveAttribute('src', /media\/v9\.2\.0-spot\.jpg/);
    });

    test('media outside the media folder is left out', async ({ page }) => {
        await openAs(page, 'v9.0.0');
        const gamma = modal(page).locator('li[data-wn-section-name="Gamma"]');
        await expect(gamma).toHaveCount(1);
        await expect(gamma.locator('img, video, .wn-media')).toHaveCount(0);
    });

    test('Show me closes the window and opens where the change lives', async ({ page }) => {
        await openAs(page, 'v9.1.0');
        await modal(page).locator('.wn-spot [data-wn-go]').click();
        await expect(modal(page)).toHaveCount(0);
        await expect(page).toHaveURL(/#config\/monitoring\/notifications$/);
        await expect(page.locator('[data-config-section="monitoring"][aria-selected="true"]')).toBeVisible();
    });

    test('the chips narrow every open release', async ({ page }) => {
        await openAs(page, 'v9.0.0');
        const shown = () => page.$$eval('.whats-new-modal .wn-rel li[data-wn-kind]',
            (els) => els.filter((el) => el.offsetParent !== null).map((el) => `${el.dataset.wnSectionName}/${el.dataset.wnKind}`));

        await modal(page).locator('[data-wn-filter-value="sec:Alpha"]').click();
        const alpha = await shown();
        expect(alpha.length).toBe(4);
        expect(alpha.every((s) => s.startsWith('Alpha/'))).toBe(true);
        // v9.1.0 stays: it has an Alpha fix. With Beta it has nothing, and goes.
        await expect(modal(page).locator('.wn-rel[data-wn-rel="v9.1.0"]')).toBeVisible();

        await modal(page).locator('[data-wn-filter-value="sec:Beta"]').click();
        await expect(modal(page).locator('.wn-rel[data-wn-rel="v9.1.0"]')).toBeHidden();

        await modal(page).locator('[data-wn-filter-value="kind:new"]').click();
        const added = await shown();
        expect(added.length).toBe(4);
        expect(added.every((s) => s.endsWith('/new'))).toBe(true);
        await expect(modal(page).locator('[data-wn-filter-value="kind:new"]')).toHaveAttribute('aria-pressed', 'true');

        await modal(page).locator('[data-wn-filter-value=""]').click();
        expect((await shown()).length).toBe(6);
    });
});
