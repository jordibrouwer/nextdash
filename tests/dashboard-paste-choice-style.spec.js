// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The paste-choice modal drew as unstyled markup on the dashboard.
 *
 * Its rules lived in dashboard-inbox.css, which rides in the views bundle and
 * is fetched only when Inbox, Health or Config is opened. This modal appears on
 * the dashboard itself, the moment a URL is pasted, so none of them had loaded:
 * the URL overlapped the question and both options collapsed onto one line.
 *
 * A stylesheet reaching the page is not something markup can assert about
 * itself, so this measures the result -- the rules being reachable, and the
 * layout they produce.
 */
test('the paste choice modal is styled on the dashboard', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Reachable without opening any view first.
    const rules = await page.evaluate(() => {
        let n = 0;
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) if (rule.cssText?.includes('paste-choice')) n++;
            } catch (_error) { /* cross-origin sheet */ }
        }
        return n;
    });
    expect(rules).toBeGreaterThan(0);

    await page.evaluate(() => window.dashboardInstance.pasteChoice
        .openChoiceModal('https://www.youtube.com/watch?v=8CRqzJyjvIQ'));
    await expect(page.locator('.paste-choice-options')).toBeVisible();

    const geo = await page.evaluate(() => {
        const box = (sel) => {
            const r = document.querySelector(sel)?.getBoundingClientRect();
            return r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const cards = [...document.querySelectorAll('.paste-choice-card')]
            .map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; });
        return { url: box('.paste-choice-url'), lead: box('.paste-choice-lead'), cards };
    });

    // The URL sat on top of the question when nothing was styled.
    expect(geo.url.y + geo.url.h).toBeLessThanOrEqual(geo.lead.y);
    // Two options, side by side rather than stacked into each other.
    expect(geo.cards).toHaveLength(2);
    expect(geo.cards[0].y).toBe(geo.cards[1].y);
    expect(geo.cards[0].x).not.toBe(geo.cards[1].x);
});

/*
 * The two cards carry the app's own marks.
 *
 * They used to carry emoji, which come from the system font: a different
 * shape on every platform, and the only two pictures on the screen that
 * matched nothing else in the app. These are the plus the header's Add
 * bookmark button draws and the tray the inbox tab draws, so a reader
 * recognises both before reading either label.
 */
test('the paste choice cards use the app\'s bookmark and inbox glyphs', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.pasteChoice
        .openChoiceModal('https://www.youtube.com/watch?v=8CRqzJyjvIQ'));
    await expect(page.locator('.paste-choice-options')).toBeVisible();

    const marks = await page.evaluate(() => {
        const icon = (choice) => document
            .querySelector(`[data-paste-choice="${choice}"] .paste-choice-card-icon`);
        const paths = (choice) => [...(icon(choice)?.querySelectorAll('svg path') || [])]
            .map((p) => p.getAttribute('d'));
        const header = document.querySelector('#quick-add-toolbar-btn svg path')?.getAttribute('d') || '';
        return {
            bookmark: paths('bookmark'),
            inbox: paths('inbox'),
            header,
            text: (icon('bookmark')?.textContent || '') + (icon('inbox')?.textContent || ''),
            drawn: icon('bookmark')?.querySelector('svg')?.getBoundingClientRect().width || 0,
        };
    });

    // The same plus the header draws, not a lookalike.
    expect(marks.bookmark).toEqual([marks.header]);
    // The inbox tray: the lip, the box and the arrow falling into it.
    expect(marks.inbox).toHaveLength(3);
    expect(marks.inbox[2]).toContain('M12 4v6');
    // No emoji left behind them.
    expect(marks.text.trim()).toBe('');
    expect(marks.drawn).toBeGreaterThan(12);
});
