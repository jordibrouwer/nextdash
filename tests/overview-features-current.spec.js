// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');

/**
 * The newest release has to name at least one feature.
 *
 * Config → Overview carries a spotlight per notable addition so a larger
 * change is not missed by someone who skimmed the release notes once. It is
 * fed by a hand-kept list, and adding to that list is a step in the
 * documentation round that is easy to skip -- nothing failed when it was.
 *
 * It was skipped for ten releases: the newest entry read `since: "v1.4.2"`
 * while the app had shipped up to v1.4.2.4, so the panel showed four features
 * all dated the same Friday and nothing since. This fails at the next release
 * instead of months later.
 *
 * Not every release earns a spotlight -- a hotfix of pure corrections has
 * nothing to announce -- so the rule is scoped to a release that the changelog
 * describes as bringing something new.
 */
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the newest release with new items also names a feature on Overview', async () => {
    const index = JSON.parse(read('static/data/whats-new/index.json'));
    const features = JSON.parse(read('static/data/overview-features.json')).features;
    const changelog = read('CHANGELOG.md');

    const covered = new Set(features.map((f) => f.since).filter(Boolean));
    expect(covered.size, 'no feature declares which release it came from').toBeGreaterThan(0);

    // Walk newest-first to the first release the changelog credits with a
    // **new** item; that is the one that owed a spotlight.
    const owing = [];
    for (const entry of index) {
        const tag = entry?.tag;
        if (!tag) continue;
        const start = changelog.indexOf(`## ${tag} —`);
        if (start < 0) continue;
        const next = changelog.indexOf('\n## v', start + 1);
        const body = changelog.slice(start, next < 0 ? undefined : next);
        if (!/^- \*\*new\*\*/m.test(body)) continue;   // corrections only: nothing to announce
        if (covered.has(tag)) break;                    // the newest such release is covered
        owing.push(tag);
    }

    expect(owing,
        `these releases brought new items but name no feature on Overview: ${owing.join(', ')}`)
        .toEqual([]);
});

test('every feature entry carries the five keys the panel reads', async () => {
    const features = JSON.parse(read('static/data/overview-features.json')).features;
    const missing = features
        .filter((f) => !['titleKey', 'whatKey', 'howKey', 'enableKey', 'ctaKey']
            .every((k) => typeof f?.[k] === 'string' && f[k]))
        .map((f) => f.titleKey || f.titleFallback || '(unnamed)');
    expect(missing, `entries missing a key: ${missing.join(', ')}`).toEqual([]);
});
