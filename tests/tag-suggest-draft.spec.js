// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function ready(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('a draft is offered the tag its rule and its site propose, never one it already has', async ({ page }) => {
    await ready(page);
    const offers = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.tagRules = [{ pattern: 'ruled.example', tag: 'reading' }];
        d.settings.dismissedTagSuggestions = [];
        // Three filed bookmarks on one site agree on #homelab: the derived source.
        d.allBookmarks = [...d.allBookmarks,
            { url: 'https://agree.example/a', name: 'a', tags: ['homelab'] },
            { url: 'https://agree.example/b', name: 'b', tags: ['homelab'] },
            { url: 'https://agree.example/c', name: 'c', tags: ['homelab'] },
        ];
        const live = window.TagSuggestLive;
        live.invalidate();
        return {
            ruled: live.forDraft(d, { url: 'https://ruled.example/x', tags: [], keywords: [] }).map((o) => o.tag),
            derived: live.forDraft(d, { url: 'https://agree.example/new', tags: [], keywords: [] }).map((o) => o.tag),
            already: live.forDraft(d, { url: 'https://ruled.example/x', tags: ['reading'], keywords: [] }).map((o) => o.tag),
        };
    });
    expect(offers.ruled).toContain('reading');
    expect(offers.derived).toContain('homelab');
    expect(offers.already).not.toContain('reading');
});

test('a refused pattern|tag is not offered to a draft', async ({ page }) => {
    await ready(page);
    const offers = await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.tagRules = [{ pattern: 'ruled.example', tag: 'reading' }];
        d.settings.dismissedTagSuggestions = ['ruled.example|reading'];
        window.TagSuggestLive.invalidate();
        return window.TagSuggestLive.forDraft(d, { url: 'https://ruled.example/x', tags: [], keywords: [] })
            .map((o) => o.tag);
    });
    expect(offers).not.toContain('reading');
});

test('changed() empties the stored-keywords promise and tells config', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(async () => {
        const live = window.TagSuggestLive;
        const d = window.dashboardInstance;
        let told = 0;
        d.config = d.config || {};
        const before = d.config.onTagEvidenceChanged;
        d.config.onTagEvidenceChanged = () => { told += 1; };
        const first = live.storedKeywords();
        live.changed(d);
        const second = live.storedKeywords();
        d.config.onTagEvidenceChanged = before;
        return { told, fresh: first !== second, isObject: typeof (await second) === 'object' };
    });
    expect(result.told).toBe(1);
    expect(result.fresh).toBe(true);
    expect(result.isObject).toBe(true);
});
