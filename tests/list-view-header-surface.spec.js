// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The header of Health and Inbox is a surface, not a rule over the page.
 *
 * It was painted in --background-primary with a hairline under it, so it read
 * as a black band across the top of a dark theme and a white one on a light
 * theme -- the one element on either page taking no colour from the theme at
 * all. It wears the dashboard widget's shape now: a rounded panel tinted with
 * a little of the text colour, so the two views and the dashboard are made of
 * the same thing.
 */

async function openView(page, key) {
    await page.setViewportSize({ width: 1400, height: 900 });
    // Enough rows for the list to scroll under the band. The inbox of a test
    // install can be empty, so its list is answered here rather than written
    // into the shared data directory.
    await page.route('**/api/inbox', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const res = await route.fetch();
        const data = await res.json();
        const now = Date.now();
        const items = Array.from({ length: 40 }, (_, i) => ({
            id: `scroll-${i}`,
            url: `https://scroll-${i}.example.com/`,
            title: `A link to scroll past ${i}`,
            addedAt: now - i * 60_000,
        }));
        await route.fulfill({ response: res, json: { ...data, items: [...(data.items || []), ...items] } });
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    // The rows being up is what says the keyboard handlers are bound; the view
    // itself is lazy, and a key pressed before that lands nowhere.
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Through the key someone presses, not through the renderer.
    await page.keyboard.press(key);
    await page.waitForSelector('.lvs-header', { timeout: 20_000 });
}

// The alpha of a computed colour: rgba(), or color(srgb … / a) from color-mix.
function alphaOf(css) {
    const m = /\/\s*([\d.]+)\s*\)$/.exec(css) || /rgba\([^)]*,\s*([\d.]+)\)$/.exec(css);
    return m ? parseFloat(m[1]) : 1;
}

/*
 * At rest the band is the card surface, see-through like the tiles beside it:
 * nothing scrolls behind it at the top of the page. Once the page scrolls the
 * rows pass behind it, and it turns nearly solid so they stay a faint shape
 * under the title and the search box.
 */
for (const [view, key] of [['health', 'Shift+H'], ['inbox', 'Shift+I']]) {
    test(`the ${view} header takes its colour from the theme`, async ({ page }) => {
        await openView(page, key);

        const read = () => page.evaluate(() => {
            const header = document.querySelector('.lvs-header');
            const cs = window.getComputedStyle(header);
            return {
                background: cs.backgroundColor,
                page: window.getComputedStyle(document.body).backgroundColor,
                radius: parseFloat(cs.borderTopLeftRadius),
            };
        });

        const rest = await read();
        expect(rest.background, 'the header is still the page colour').not.toBe(rest.page);
        expect(rest.radius, 'the header is still a full-width band').toBeGreaterThan(0);

        // Scrolled the way a reader scrolls: the wheel over the list.
        await page.mouse.move(700, 600);
        await page.mouse.wheel(0, 600);
        await expect(page.locator('body')).toHaveAttribute('data-scrolled', 'true', { timeout: 5_000 });
        await expect.poll(async () => alphaOf((await read()).background), {
            message: 'rows scroll visibly through the header',
            timeout: 5_000,
        }).toBeGreaterThanOrEqual(0.85);
    });
}
