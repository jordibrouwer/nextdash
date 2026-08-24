// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

// This server runs with a write token, so capture needs one in the URL — which
// is the point of the rule: a share sheet and a bookmarklet cannot send a
// header, so a locked install has to be told explicitly who is knocking.
const TOKEN = process.env.NEXTDASH_WRITE_TOKEN || 'playwright-e2e-write-token';
const auth = `&token=${encodeURIComponent(TOKEN)}`;

/**
 * Saving a link from outside the dashboard: the phone's share sheet and the
 * bookmarklet. Both are plain GETs, because neither can set a header.
 *
 * What is checked in the browser rather than in Go: that /share lands on the
 * inbox and says what happened, that the marker is taken back out of the URL so
 * a reload does not claim a save that happened once, and that Help can hand you
 * a bookmarklet with this install's own address in it.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
}

test.describe('a shared link lands in the inbox', () => {
    test('/share saves it and the inbox says so, once', async ({ page }) => {
        await dashboard(page);
        const url = `https://shared-${Date.now()}.example.com/a`;

        await page.goto(`/share?title=Shared&text=${encodeURIComponent(`Shared ${url}`)}${auth}`);
        // The redirect lands on the inbox with the outcome in the address.
        await page.waitForFunction(() => window.dashboardInstance?.inbox, null, { timeout: 20_000 });
        await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toContain('inbox');

        await dismissOnboardingIfPresent(page);
        await page.waitForTimeout(1200);
        // Reported, then cleaned out of the URL: a reload must not repeat a
        // confirmation for something that happened minutes ago.
        expect(await page.evaluate(() => new URL(location.href).searchParams.get('captured'))).toBeNull();

        const saved = await page.evaluate(async (target) => {
            const res = await fetch('/api/inbox');
            const body = await res.json();
            const items = Array.isArray(body) ? body : (body.items || []);
            const hit = items.find((i) => i.url === target);
            return hit ? { title: hit.title, source: hit.source } : null;
        }, url);
        expect(saved).not.toBeNull();
        // The title is what is left of the shared text once the URL is out of it.
        expect(saved.title).toBe('Shared');
        expect(saved.source).toBe('share');
    });
});

test.describe('the bookmarklet route', () => {
    test('/add answers with a page a person can read', async ({ page }) => {
        const url = `https://added-${Date.now()}.example.com/b`;
        await page.goto(`/add?url=${encodeURIComponent(url)}&title=From+a+bookmarklet${auth}`);
        await expect(page.locator('h1')).toHaveText(/saved to the inbox/i);
        await expect(page.locator('body')).toContainText('From a bookmarklet');

        // The same link twice is not an error: it is already where it was meant
        // to go.
        await page.goto(`/add?url=${encodeURIComponent(url)}${auth}`);
        await expect(page.locator('h1')).toHaveText(/already in the inbox/i);
    });
});

test.describe('a locked install refuses politely', () => {
    test('/add without a token says which one it wants', async ({ page }) => {
        await page.goto('/add?url=https://denied.example.com/x');
        await expect(page.locator('h1')).toHaveText(/not saved/i);
        await expect(page.locator('body')).toContainText(/capture token/i);
    });
});

test.describe('Help hands you the bookmarklet', () => {
    test('it carries this install and follows the token field', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return c.openConfigView('help');
        });
        await page.waitForSelector('.config-view-body', { timeout: 20_000 });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            c.helpTab = 'inbox';
            c.render();
        });
        await page.waitForSelector('[data-capture-bookmarklet]', { timeout: 10_000 });

        const line = await page.locator('[data-capture-bookmarklet]').inputValue();
        expect(line).toContain('javascript:');
        expect(line).toContain(`${new URL(page.url()).origin}/add?url=`);
        expect(line).not.toContain('token=');

        // A token typed in ends up in the line, so nobody has to edit it by hand.
        await page.locator('[data-capture-token]').fill('abc123');
        await page.waitForTimeout(400);
        expect(await page.locator('[data-capture-bookmarklet]').inputValue()).toContain('token=abc123');
    });
});
