// @ts-check
const { test, expect } = require('./fixtures');

/**
 * A stack trace out of the bundle names the file the code was written in.
 *
 * Concatenating 117 scripts into one response costs attribution: everything
 * reports as `dashboard.js` at a line number nobody can place, and the
 * workaround was to reproduce the problem in a different build
 * (NEXTDASH_BUNDLE=off) from the one that had it.
 *
 * A `//# sourceURL` per file cannot fix this — checked in a browser, the last
 * such directive wins for the whole script, so several of them make every
 * function report as the last file in the bundle. A source map is the
 * mechanism, and it is cheap here because the bundle is plain concatenation:
 * one line of a source is one line of the bundle at a fixed offset.
 */
test('the script bundle points at a source map that names its files', async ({ page, baseURL }) => {
    const bundle = await page.request.get(`${baseURL}/static/bundle/dashboard.js`);
    expect(bundle.ok()).toBe(true);
    const body = await bundle.text();

    const ref = body.match(/\/\/# sourceMappingURL=(\S+)/);
    expect(ref, 'the bundle carries no sourceMappingURL').toBeTruthy();

    const map = await page.request.get(new URL(ref[1], baseURL).toString());
    expect(map.ok(), 'the source map the bundle points at does not resolve').toBe(true);

    const sm = await map.json();
    expect(sm.version).toBe(3);
    expect(Array.isArray(sm.sources)).toBe(true);
    // Not a token count: the point is that real files are named.
    expect(sm.sources.length).toBeGreaterThan(50);
    for (const known of ['/static/js/keyboard-navigation.js', '/static/js/status.js']) {
        expect(sm.sources, `${known} is in the bundle but not in its map`).toContain(known);
    }
    // One mapping group per line of the bundle, so any line resolves.
    expect(sm.mappings.split(';').length).toBeGreaterThan(1000);
});

test('the deferred search bundle has one too', async ({ page, baseURL }) => {
    const bundle = await page.request.get(`${baseURL}/static/bundle/search.js`);
    expect(bundle.ok()).toBe(true);
    const ref = (await bundle.text()).match(/\/\/# sourceMappingURL=(\S+)/);
    expect(ref).toBeTruthy();

    const sm = await (await page.request.get(new URL(ref[1], baseURL).toString())).json();
    expect(sm.sources).toContain('/static/js/search.js');
});

test('the stylesheet bundle does not pretend to have one', async ({ page, baseURL }) => {
    // A stylesheet produces no stack traces, so a map would be weight for
    // nothing — and a CSS file ending in a JS comment is a parse error.
    const css = await (await page.request.get(`${baseURL}/static/bundle/dashboard.css`)).text();
    expect(css).not.toContain('sourceMappingURL');
    expect(css.trimEnd().endsWith('*/') || !css.trimEnd().endsWith('//')).toBe(true);
});
