// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The weekly digest's dashboard card (static/js/digest-notice.js).
 *
 * The digest itself is built and sent by the server (internal/app/digest.go);
 * the proof route builds one from live data now, which is how these tests get
 * a snapshot without waiting for Monday. One Inbox item is enough to make the
 * digest non-empty on a fresh install.
 */

const CARD = '.digest-notice-card';
const headers = { 'X-NextDash-Token': WRITE_TOKEN };

let seeded = 0;

async function seedAndSend(request) {
    seeded += 1;
    const added = await request.post('/api/inbox', { data: { url: `https://digest-e2e-${seeded}.example/` }, headers });
    expect(added.ok()).toBeTruthy();
    const sent = await request.post('/api/digest/test', { headers });
    expect(sent.status()).toBe(200);
    return sent.json();
}

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.settings && window.DigestNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Other corner cards may hold the corner after a fresh reset; this spec
    // is about the digest card only.
    await page.evaluate(() => {
        document.querySelectorAll('.quickstart-card:not(.digest-notice-card)').forEach((el) => el.remove());
    });
}

async function forgetSeen(page) {
    await page.evaluate(() => window.localStorage.removeItem('nextdashDigestSeenAt'));
}

async function renderCard(page) {
    return page.evaluate(() => window.DigestNotice.render());
}

test.describe('the weekly digest card', () => {
    test('a proof digest shows once, and a newer one shows again', async ({ page, request }) => {
        await seedAndSend(request);
        await loadDashboard(page);
        await forgetSeen(page);

        expect(await renderCard(page)).toBe(true);
        const card = page.locator(CARD);
        await expect(card).toBeVisible();
        await expect(card).toContainText('Your week in nextDash');
        await expect(card).toContainText('in the Inbox');

        await card.locator('[data-digest-action="seen"]:not([data-notice-dismiss])').click();
        await expect(card).toHaveCount(0);

        // Seen: after a reload the same snapshot is not offered again.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.settings && window.DigestNotice, null, { timeout: 15_000 });
        expect(await renderCard(page)).toBe(false);
    });

    test('a newer digest after the seen one is offered again', async ({ page, request }) => {
        const first = await seedAndSend(request);
        await loadDashboard(page);
        await page.evaluate((at) => window.localStorage.setItem('nextdashDigestSeenAt', String(at)), first.generatedAt);
        expect(await renderCard(page)).toBe(false);

        const second = await (await request.post('/api/digest/test', { headers })).json();
        expect(second.generatedAt).toBeGreaterThan(first.generatedAt);
        expect(await renderCard(page)).toBe(true);
        await expect(page.locator(CARD)).toBeVisible();
    });

    test('no card while the digest is switched off', async ({ page, request }) => {
        await seedAndSend(request);
        const off = await request.post('/api/settings', { data: { digestEnabled: false }, headers });
        expect(off.ok()).toBeTruthy();
        await loadDashboard(page);
        await forgetSeen(page);
        expect(await renderCard(page)).toBe(false);
        await expect(page.locator(CARD)).toHaveCount(0);

        const on = await request.post('/api/settings', { data: { digestEnabled: true }, headers });
        expect(on.ok()).toBeTruthy();
    });
});

test.describe('the digest window', () => {
    test('"Read the digest" opens it, and a part opens its view', async ({ page, request }) => {
        await seedAndSend(request);
        await loadDashboard(page);
        await forgetSeen(page);
        expect(await renderCard(page)).toBe(true);

        await page.locator(`${CARD} [data-digest-action="read"]`).click();
        const win = page.locator('.digest-modal .digest-window');
        await expect(win).toBeVisible();
        await expect(page.locator(CARD)).toHaveCount(0);
        await expect(win.locator('[data-digest-part="inbox"]')).toContainText('waiting to be sorted');

        await win.locator('[data-digest-go="inbox"]').click();
        await expect(win).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    });

    async function seedTwoParts(request) {
        // A bookmark nobody opened (as every bookmark of a fresh install is),
        // and an Inbox item: two parts with a view to open, so the bar has a
        // next one.
        const day = 24 * 60 * 60 * 1000;
        const dust = await request.post('/api/bookmarks/add', {
            data: { page: 1, bookmark: { name: 'Dust', url: `https://digest-dust-${Date.now()}.example/`, createdAt: Date.now() - 200 * day } },
            headers,
        });
        expect(dust.ok()).toBeTruthy();
        return seedAndSend(request);
    }

    async function openFresh(page) {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.localStorage.removeItem('nextdashDigestSeenAt');
            window.localStorage.removeItem('nextdashDigestProgress');
        });
        await page.evaluate(() => window.DigestNotice.openDigest());
        return page.locator('.digest-modal .digest-window');
    }

    test('a part opened shrinks it to a bar that leads to the next part', async ({ page, request }) => {
        await seedTwoParts(request);
        const win = await openFresh(page);
        await win.locator('[data-digest-go="inbox"]').click();

        const bar = page.locator('.digest-bar');
        await expect(bar).toBeVisible();
        await expect(bar).toContainText('1 of 2 done');
        await expect(bar.locator('[data-digest-bar="next"]')).toHaveText('Next: Never opened');
        // It holds the corner, so no notice card lands on top of it.
        await expect(bar).toHaveAttribute('data-holds-corner', '');

        // Back to the window from the bar: the opened part is ticked, the
        // next one stands out.
        await bar.locator('[data-digest-bar="open"]').click();
        await expect(win.locator('[data-digest-part="inbox"]')).toHaveClass(/is-done/);
        await expect(win.locator('[data-digest-go="inbox"]')).toHaveText('Open again');
        await expect(win.locator('[data-digest-go="unused"]')).toHaveClass(/is-next/);
        await expect(page.locator('.digest-bar')).toHaveCount(0);

        // Closed with Done halfway: the bar comes back, and survives a reload.
        await page.locator('#modal-actions button').first().click();
        await expect(page.locator('.digest-bar')).toBeVisible();
        await page.reload();
        await expect(page.locator('.digest-bar')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');

        // Next opens the last part, and with nothing left the bar goes.
        await page.locator('.digest-bar [data-digest-bar="next"]').click();
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#bookmarks?health=unused');
        await expect(page.locator('.digest-bar')).toHaveCount(0);
    });

    test('the bar closes for this digest', async ({ page, request }) => {
        await seedTwoParts(request);
        const win = await openFresh(page);
        await win.locator('[data-digest-go="inbox"]').click();
        await expect(page.locator('.digest-bar')).toBeVisible();

        // While it stands, a corner card waits; once it is gone, the card may come.
        await page.goto('/');
        await expect(page.locator('.digest-bar')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
        await page.evaluate(() => {
            document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        });
        await page.evaluate(() => {
            window.__probeCard = window.NoticeCard.define({ id: 'digest-probe', title: () => 'Probe', body: () => 'Probe', canShow: () => true, actions: [] });
        });
        expect(await page.evaluate(() => window.__probeCard.render())).toBe(false);

        await page.locator('.digest-bar [data-digest-bar="close"]').click();
        await expect(page.locator('.digest-bar')).toHaveCount(0);
        expect(await page.evaluate(() => window.__probeCard.render())).toBe(true);
        await page.evaluate(() => window.__probeCard.close());
        await page.reload();
        await page.waitForFunction(() => window.DigestNotice, null, { timeout: 15_000 });
        // Must not happen: the closed bar coming back. Give the notice time to
        // decide before checking it stayed away.
        await page.waitForTimeout(1000);
        await expect(page.locator('.digest-bar')).toHaveCount(0);
    });

    test('the address the push opens shows it, once', async ({ page, request }) => {
        await seedAndSend(request);
        await markWhatsNewSeen(page);
        await page.goto('/#digest');
        await expect(page.locator('.digest-modal .digest-window')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe('#digest');

        // Taken off the address, so a reload does not open it again.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.settings && window.DigestNotice, null, { timeout: 15_000 });
        // Must not happen: the digest opening again after the reload. Give it
        // time to open before checking it did not.
        await page.waitForTimeout(1500);
        await expect(page.locator('.digest-modal .digest-window')).toHaveCount(0);
    });
});


test.describe('the digest and the review card', () => {
    test('the review card waits while there is an unseen digest', async ({ page, request }) => {
        await seedAndSend(request);
        await loadDashboard(page);
        await forgetSeen(page);
        await page.evaluate(() => {
            window.localStorage.removeItem('nextdashHealthReviewDoneOn');
            window.localStorage.removeItem('nextdashHealthReviewSnoozeUntil');
        });
        // Fresh install: every bookmark is never opened, enough for a session.
        expect(await page.evaluate(() => window.DigestNotice.holdsTheWeek())).toBe(true);
        expect(await page.evaluate(() => window.HealthReviewSession.shouldShow())).toBe(false);

        // With the digest off, the review card is offered as before.
        await page.evaluate(() => { window.dashboardInstance.settings.digestEnabled = false; });
        expect(await page.evaluate(() => window.DigestNotice.holdsTheWeek())).toBe(false);
        expect(await page.evaluate(() => window.HealthReviewSession.shouldShow())).toBe(true);
    });

    test('"Work through" starts a session on the broken links', async ({ page, request }) => {
        const broken = await request.post('/api/bookmarks/add', {
            data: { page: 1, bookmark: { name: 'Gone', url: `https://digest-gone-${Date.now()}.example/`, checkStatus: true, lastError: 'timeout', brokenSince: Date.now() - 60_000, lastChecked: Date.now() } },
            headers,
        });
        expect(broken.ok()).toBeTruthy();
        await seedAndSend(request);
        await loadDashboard(page);
        await page.evaluate(() => window.localStorage.removeItem('nextdashDigestProgress'));
        await page.evaluate(() => window.DigestNotice.openDigest());
        const win = page.locator('.digest-modal .digest-window');
        await expect(win.locator('[data-digest-part="broken"]')).toContainText('Gone');

        await win.locator('[data-digest-work="broken"]').click();
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#bookmarks?health=broken');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
        // The view's own Work through, on the broken links only: the walk is
        // as long as the report counts broken, not the whole review queue
        // (the review card's session would take every never-opened link too).
        await page.locator('[data-focus-pile="list"]').click({ timeout: 15_000 });
        await expect(page.locator('.health-focus-card')).toBeVisible();
        const summary = await page.evaluate(() => window.HealthBadgeUtils.fetchBookmarkHealthSummary());
        const brokenCount = Number(summary.brokenCount);
        expect(brokenCount).toBeGreaterThan(0);
        await expect(page.locator('.health-focus-progress')).toContainText(`of ${brokenCount}`);
        await expect(page.locator('.digest-bar')).toBeVisible();
    });
});

/*
 * The window's counts and bars, and the two ways in besides the card and the
 * push: the :digest command and the panel on Config's overview.
 */
test.describe('tiles, bars and the ways in', () => {
    // A week with something in every kind: what the tiles, the bars and the
    // ways in are drawn from.
    const fullWeek = () => ({
        dueKey: '2026-10-26', generatedAt: Date.now(),
        health: {
            newlyBroken: ['Forgejo'], stillBroken: 2,
            certsExpiring: ['old.example (-21 days)', 'soon.example (7 days)', 'later.example (40 days)'],
            domainsExpiring: ['near.example (20 days)', 'mid.example (150 days)', 'far.example (800 days)'],
        },
        usage: { neverOpened: 3, neverOpenedNames: ['A', 'B', 'C'] },
    });

    async function openRouted(page, snapshot) {
        await page.route('**/api/digest/latest', (route) => route.fulfill({ json: snapshot }));
        await loadDashboard(page);
        await page.evaluate(() => {
            window.localStorage.removeItem('nextdashDigestSeenAt');
            window.localStorage.removeItem('nextdashDigestProgress');
        });
    }

    test('counts across the top, and days left as bars', async ({ page }) => {
        await openRouted(page, fullWeek());
        await page.evaluate(() => window.DigestNotice.openDigest());
        const win = page.locator('.digest-modal .digest-window');

        // Broken old and new together; certificates and domains within 30
        // days together, the gone one included.
        const tiles = win.locator('[data-digest-tile]');
        await expect(tiles.locator('.digest-tile-label')).toHaveText(['broken links', 'run out within 30 days', 'never opened']);
        await expect(tiles.locator('.digest-tile-count')).toHaveText(['3', '3', '3']);

        const certs = win.locator('[data-digest-part="certificates"] .digest-days-row');
        await expect(certs.locator('.digest-days-name')).toHaveText(['old.example', 'soon.example', 'later.example']);
        await expect(certs.first().locator('.digest-days-value')).toHaveText('expired 21 d');
        await expect(certs.first()).toHaveClass(/is-bad/);

        // Domains: a bar for what is coming, a count for the rest.
        const domains = win.locator('[data-digest-part="domains"]');
        await expect(domains.locator('.digest-days-name')).toHaveText(['near.example', 'mid.example']);
        await expect(domains.locator('.digest-chip')).toHaveText(['+1 more than 200 days away']);

        await expect(win.locator('[data-digest-part="broken"] .digest-chip')).toHaveText(['Forgejo', '+2 older']);
    });

    test('a tile opens its view, and is ticked when the digest comes back', async ({ page }) => {
        await openRouted(page, fullWeek());
        await page.evaluate(() => window.DigestNotice.openDigest());
        const win = page.locator('.digest-modal .digest-window');

        await win.locator('[data-digest-tile="unused"]').click();
        await expect(win).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#bookmarks?health=unused');
        await expect(page.locator('.digest-bar')).toContainText('1 of 4 done');

        await page.locator('.digest-bar [data-digest-bar="open"]').click();
        await expect(win.locator('[data-digest-tile="unused"]')).toHaveClass(/is-done/);
        await expect(win.locator('[data-digest-part="never"]')).toHaveClass(/is-done/);
        await expect(win.locator('[data-digest-tile="certificates"]')).not.toHaveClass(/is-done/);
    });

    test(':digest opens the latest digest', async ({ page }) => {
        await openRouted(page, fullWeek());
        await page.keyboard.press(':');
        await page.keyboard.type('digest');
        await page.keyboard.press('Enter');
        await expect(page.locator('.digest-modal .digest-window')).toBeVisible();
    });

    test('the Config overview has a panel that opens it', async ({ page }) => {
        await openRouted(page, fullWeek());
        await waitForConfigReady(page);
        await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('overview'); });
        const panel = page.locator('#config-view-body .config-widget--digest');
        await expect(panel).toBeVisible({ timeout: 10_000 });
        await expect(panel.locator('.config-widget-value')).toHaveText('4');
        await panel.locator('[data-overview-go]').click();
        await expect(page.locator('.digest-modal .digest-window')).toBeVisible();
    });
});

/*
 * nextDash's own releases of the week: last in the window, with a button to
 * What's new, and not one of the parts the bar counts as to do.
 */
test.describe('the news part', () => {
    test('names the week\'s releases and their highlights, and opens What\'s new', async ({ page }) => {
        const snapshot = {
            dueKey: '2026-10-12', generatedAt: Date.now(),
            usage: { inbox: 2 },
            news: { releases: ['v9.2.0'], highlights: ['A short title', 'Another one'] },
        };
        await page.route('**/api/digest/latest', (route) => route.fulfill({ json: snapshot }));
        await loadDashboard(page);
        await forgetSeen(page);
        await page.evaluate(() => window.localStorage.removeItem('nextdashDigestProgress'));
        expect(await renderCard(page)).toBe(true);
        await expect(page.locator(CARD)).toContainText('nextDash v9.2.0 is out');

        await page.locator(`${CARD} [data-digest-action="read"]`).click();
        const win = page.locator('.digest-modal .digest-window');
        const part = win.locator('[data-digest-part="news"]');
        await expect(part).toContainText('New in nextDash');
        await expect(part).toContainText('v9.2.0 came out this week');
        await expect(part.locator('.digest-chip')).toHaveText(['A short title', 'Another one']);
        // Last, after the parts that need the reader.
        const ids = await win.locator('[data-digest-part]').evaluateAll((els) => els.map((el) => el.dataset.digestPart));
        expect(ids[ids.length - 1]).toBe('news');
        // The Inbox is the next thing to do, not the news.
        await expect(win.locator('[data-digest-go="inbox"]')).toHaveClass(/is-next/);

        await part.locator('[data-digest-go="whats-new"]').click();
        await expect(page.locator('.whats-new-modal')).toBeVisible();
        await expect(page.locator('.digest-bar')).toHaveCount(0);
    });
});
