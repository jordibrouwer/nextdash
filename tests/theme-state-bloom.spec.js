// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A bloom marks what is live, and nothing else.
 *
 * The app already has an ambient glow -- --surface-glow-ring, an accent halo
 * under raised surfaces, set per theme. That one sits on resting surfaces. A
 * state bloom is the opposite: tighter, brighter, and only on what the reader
 * is acting on right now. Keeping the two separable is the whole point; once
 * two effects look alike, neither means anything.
 *
 * It decorates, it never informs on its own: the focus outline stays exactly
 * where it was, so a reader who cannot see the glow loses nothing.
 */

async function openDashboard(page, depth = 'rich') {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => document.body.setAttribute('data-depth', value), depth);
}

const tokenValue = (page, name) => page.evaluate(
    (prop) => window.getComputedStyle(document.body).getPropertyValue(prop).trim(),
    name,
);

const paints = (value) => value !== '' && !/^none$/.test(value)
    && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/.test(value);

test.describe('the state bloom', () => {
    test('is defined, accent-derived, and tighter than the ambient glow', async ({ page }) => {
        await openDashboard(page);

        const bloom = await tokenValue(page, '--bloom');
        expect(bloom, '--bloom is not defined').not.toBe('');

        // Not an inset: this sits around the element, not on it.
        expect(bloom).not.toContain('inset');

        // Tighter than the resting halo. --surface-glow-ring blurs at 18px+
        // and spreads negative; the bloom is a close ring.
        const blur = Number((bloom.match(/(\d+(?:\.\d+)?)px/g) || [])[2]?.replace('px', '') ?? 0);
        expect(blur, `expected a tight blur, got: ${bloom}`).toBeLessThanOrEqual(16);
    });

    test('flat means flat, here too', async ({ page }) => {
        await openDashboard(page, 'flat');
        expect(paints(await tokenValue(page, '--bloom')), 'flat drew a bloom').toBe(false);
    });

    test('the keyboard cursor blooms, and the focus outline is left alone', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            // Read the token through an element that actually paints it: a
            // custom property read straight off body comes back as the text
            // "0 0 12px color-mix(...)", with the mix never evaluated.
            const probe = document.createElement('div');
            probe.style.boxShadow = 'var(--bloom)';
            document.body.appendChild(probe);
            const bloom = window.getComputedStyle(probe).boxShadow;
            probe.remove();

            // Selection is a class, so it can be driven here. :focus-visible
            // cannot: Chromium only matches it after real keyboard input, and
            // a scripted focus() does not qualify. The same rule paints both.
            // A row without a status bar. A status row deliberately clears its
            // box-shadow so the inset bar that says online/offline wins, and
            // that is the right call: the bar is information, the bloom is
            // decoration.
            const row = [...document.querySelectorAll('.bookmark-link')]
                .find((el) => !el.matches('.status-online, .status-offline, .status-checking'));
            row.classList.add('keyboard-selected');
            // .bookmark-link transitions box-shadow over 0.16s, so reading it
            // in the same tick returns the starting frame -- a transparent
            // zero-size shadow that looks exactly like "no bloom".
            await new Promise((resolve) => setTimeout(resolve, 300));
            const shadow = window.getComputedStyle(row).boxShadow;
            row.classList.remove('keyboard-selected');
            await new Promise((resolve) => setTimeout(resolve, 300));

            return { bloom, shadow, restingShadow: window.getComputedStyle(row).boxShadow };
        });

        expect(result.bloom, 'the bloom token resolved to nothing').not.toBe('none');
        expect(result.shadow, 'the keyboard cursor did not take the bloom')
            .toContain(result.bloom);
        expect(result.restingShadow, 'a resting row blooms, which makes the mark meaningless')
            .not.toContain(result.bloom);
    });

    test('a resting control does not bloom', async ({ page }) => {
        await openDashboard(page);

        const shadow = await page.evaluate(() => {
            const btn = document.getElementById('search-button');
            btn.blur();
            return window.getComputedStyle(btn).boxShadow;
        });

        // Whatever a resting button carries, it is not the accent ring: that
        // would make the mark meaningless.
        expect(shadow === 'none' || !shadow.includes('inset 0 0')).toBe(true);
    });
});
