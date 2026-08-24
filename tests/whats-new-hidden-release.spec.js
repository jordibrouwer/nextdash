// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A release can be recorded without being announced.
 *
 * The release tag, Config → Overview → Latest update and the What's new modal
 * all read the first entry of the what's-new index, and a Go test ties the tag
 * to it — so a docs-only or maintenance release cannot simply be left out of the
 * index without rolling the other two back to the previous version. The
 * hideFromModal flag keeps the entry in the index, and out of the modal.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('a release flagged hideFromModal', () => {
    test('is still the newest entry in the index when flagged', async ({ page }) => {
        await page.route('**/static/data/whats-new/index.json*', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 'v2026.09.9',
                    tag: 'v2026.09.9',
                    date: 'August 2026',
                    releasedAt: '2026-08-04',
                    hideFromModal: true,
                },
                {
                    id: 'v2026.09.2',
                    tag: 'v2026.09.2',
                    date: 'August 2026',
                    releasedAt: '2026-08-04',
                },
            ]),
        }));

        await page.goto('/');
        const index = await page.evaluate(async () => {
            const res = await fetch('/static/data/whats-new/index.json');
            return res.json();
        });
        expect(index[0].id).toBe('v2026.09.9');
        expect(index[0].hideFromModal).toBe(true);
    });

    test('names the release in Config → Help', async ({ page }) => {
        await page.route('**/static/data/whats-new/index.json*', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 'v2026.09.9',
                    tag: 'v2026.09.9',
                    date: 'August 2026',
                    releasedAt: '2026-08-04',
                    hideFromModal: true,
                },
                {
                    id: 'v2026.09.2',
                    tag: 'v2026.09.2',
                    date: 'August 2026',
                    releasedAt: '2026-08-04',
                },
            ]),
        }));

        // The panel renders the release itself, not just its tag, so the file the
        // index points at has to exist too — without this the fetch 404s and the
        // panel falls back to "Release notes are not available".
        await page.route('**/static/data/whats-new/v2026.09.9.json*', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                tag: 'v2026.09.9',
                date: 'August 2026',
                releasedAt: '2026-08-04',
                modalLead: 'A maintenance release recorded but not announced.',
                sections: [],
            }),
        }));

        await loadDashboard(page);
        // Help's version heading reads the same index, and is where the release
        // number lives now that the overview's Latest update panel is gone —
        // it said what the update bar above it already said, with the site's
        // own post about the release a click away in its place.
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.openConfigView('help');
            c.helpTab = 'start';
            c.render();
        });
        await expect.poll(() => page.evaluate(() =>
            document.getElementById('config-help-body')?.innerText || ''), { timeout: 15_000 })
            .toContain('2026.09.9');
    });

    test('does not appear in the What\'s new modal', async ({ page }) => {
        await page.route('**/static/data/whats-new/index.json*', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 'v2026.09.9',
                    tag: 'v2026.09.9',
                    date: 'August 2026',
                    releasedAt: '2026-08-04',
                    hideFromModal: true,
                },
                {
                    id: 'v2026.09.2',
                    tag: 'v2026.09.2',
                    date: 'August 2026',
                    releasedAt: '2026-08-04',
                },
            ]),
        }));

        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openWhatsNew());
        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1200);

        const tags = await modal.evaluate((m) => [...new Set(
            [...m.querySelectorAll('*')]
                .filter((e) => e.childElementCount === 0)
                .map((e) => e.textContent.trim())
                .filter((t) => /^v2026\.\d/.test(t)),
        )]);
        expect(tags).toContain('v2026.09.2');
        expect(tags).not.toContain('v2026.09.9');
    });

    // The cases above prove the mechanism against a fixture. This one asserts
    // what the shipped files do with it, which is the part a release gets wrong:
    // a flag left on hides a release nobody meant to hide, and a flag taken off
    // without bumping the tokens announces it to nobody.
    test('v1.3.3.3 leads the index and the modal, with v1.2.1 still hidden behind it', async ({ page }) => {
        await loadDashboard(page);

        const index = await page.evaluate(async () =>
            (await fetch('/static/data/whats-new/index.json')).json());
        // The newest entry is the one the release tag and Config → Overview →
        // Latest update read, flag or no flag.
        expect(index[0].tag).toBe('v1.3.3.3');
        expect(index[0].hideFromModal).toBeUndefined();
        expect(index[1].tag).toBe('v1.3.3.2');
        expect(index[2].tag).toBe('v1.3.3.1');
        // And the hidden one further down stays hidden: a release recorded but
        // not announced does not become announced because a later one shipped.
        const hidden = index.find((e) => e.tag === 'v1.2.1');
        expect(hidden.hideFromModal).toBe(true);

        await page.evaluate(() => window.dashboardInstance.config.openWhatsNew());
        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1200);

        const shownTags = () => modal.evaluate((m) => [...new Set(
            [...m.querySelectorAll('*')]
                .filter((e) => e.childElementCount === 0)
                .map((e) => e.textContent.trim())
                // Three parts or four: a hotfix tag is v1.3.3.3.
                .filter((t) => /^v\d+\.\d+\.\d+(\.\d+)?$/.test(t)),
        )]);
        // v1.3.3.3 leads; v1.2.1 is skipped wherever the reader scrolls, which
        // is the whole of what hideFromModal promises.
        expect(await shownTags()).toContain('v1.3.3.3');
        expect(await shownTags()).not.toContain('v1.2.1');

        // Releases load one at a time as you scroll, and this one fills the
        // panel several times over. The next announced release down is a scroll
        // away, not missing — and it is v1.2.0, the hidden one having been
        // stepped over.
        await expect.poll(async () => {
            await modal.evaluate((m) => {
                const body = m.querySelector('.modal-body') || m;
                body.scrollTop = body.scrollHeight;
            });
            return shownTags();
        }, { timeout: 20_000 }).toContain('v1.2.0');
        expect(await shownTags()).not.toContain('v1.2.1');
    });

    // These two tokens are what reopens the modal for everyone, so they follow
    // the newest *announced* release: bumped here, where v1.2.1 deliberately
    // left them alone. A feature release nobody is shown is not a release.
    test('the release constants name v1.3.3.3, the release the modal leads with', async ({ page }) => {
        const stub = await page.request.get('/static/js/whats-new-stub.js');
        const src = await stub.text();
        expect(src).toContain("DASHBOARD_RELEASE = '2026.08-dashboard-release-v1.3.3.3'");
        expect(src).toContain("NEXTDASH_WHATS_NEW_DATA_VERSION = 'whats-new-v253'");
    });
});
