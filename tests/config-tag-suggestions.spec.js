// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, waitForConfigReady } = require('./e2e-helpers');

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.TagSuggestions, null, { timeout: 15_000 });
}

const items = (rows) => rows.map(([key, url, tags]) => ({ key, url, tags: tags || [] }));

/**
 * Config -> Bookmarks -> Tag suggestions, through the strip the reader clicks
 * rather than by setting bmTab by hand.
 */
async function openSuggestionsTab(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    const tab = page.locator('[data-bm-tab="tag-suggestions"]');
    await tab.click({ timeout: 15_000 });
    await expect(page.locator('#config-bm-suggestions')).toBeVisible({ timeout: 15_000 });
}

/** Config -> Bookmarks -> Your rules, through the strip. */
async function openRulesTab(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    const tab = page.locator('[data-bm-tab="tag-rules"]');
    await tab.click({ timeout: 15_000 });
    await expect(page.locator('#config-bm-tag-rules')).toBeVisible({ timeout: 15_000 });
}

test.describe('the tag suggestion engine', () => {
    test('reads a pattern from a URL, host first and host plus segment after', async ({ page }) => {
        await open(page);
        const got = await page.evaluate(() => ({
            plain: window.TagSuggestions.patternsFor('https://www.GitHub.com/jordibrouwer/nextdash'),
            root: window.TagSuggestions.patternsFor('https://example.com'),
            refused: window.TagSuggestions.patternsFor('mailto:someone@example.com'),
        }));
        expect(got.plain).toEqual(['github.com', 'github.com/jordibrouwer']);
        expect(got.root).toEqual(['example.com']);
        expect(got.refused).toEqual([]);
    });

    test('proposes the tag the rest of the group already carries', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            tag: 'code', pattern: 'github.com', keys: ['d'],
        });
        expect(groups[0].reason).toEqual({ kind: 'derived', have: 3, of: 3 });
    });

    test('says nothing when the group is too small or too split', async ({ page }) => {
        await open(page);
        const got = await page.evaluate((sets) => ({
            small: window.TagSuggestions.suggest(sets.small),
            split: window.TagSuggestions.suggest(sets.split),
        }), {
            small: items([['a', 'https://tiny.example/one', ['code']], ['b', 'https://tiny.example/two', []]]),
            split: items([
                ['a', 'https://mixed.example/one', ['code']],
                ['b', 'https://mixed.example/two', ['news']],
                ['c', 'https://mixed.example/three', ['video']],
                ['d', 'https://mixed.example/four', []],
            ]),
        });
        expect(got.small).toEqual([]);
        expect(got.split).toEqual([]);
    });

    test('a rule wins, and needs no group behind it', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows, {
            rules: [{ pattern: 'github.com', tag: 'work' }],
        }), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        const byTag = Object.fromEntries(groups.map((g) => [g.tag, g]));
        expect(byTag.work.reason).toEqual({ kind: 'rule' });
        expect(byTag.work.keys.sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(byTag.code.keys).toEqual(['d']);
    });

    test('two tagged bookmarks are not enough evidence for a group of thirty', async ({ page }) => {
        await open(page);
        const rows = [];
        for (let i = 0; i < 30; i += 1) {
            rows.push([`k${i}`, `https://thin.example/page${i}`, i < 2 ? ['todo'] : []]);
        }
        const got = await page.evaluate((sets) => ({
            thin: window.TagSuggestions.suggest(sets.thin),
            enough: window.TagSuggestions.suggest(sets.enough),
        }), {
            thin: items(rows),
            // The same shape with a third tagged bookmark: three is what the
            // empty panel asks the reader for, so three is what it takes.
            enough: items(rows.map(([k, url, tags], i) => [k, url, i < 3 ? ['todo'] : tags])),
        });
        // Two of two agree unanimously, which used to be enough to offer
        // #todo to the other twenty-eight.
        expect(got.thin).toEqual([]);
        expect(got.enough).toHaveLength(1);
        expect(got.enough[0].keys).toHaveLength(27);
    });

    test('the catalogue names a subject for a site the collection says nothing about', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows, {
            catalogue: [{ tag: 'dev', aliases: ['code', 'programming'], hosts: ['github.com'] }],
        }), items([
            ['a', 'https://github.com/one', []],
            ['b', 'https://github.com/two', []],
        ]));
        // No group agrees on anything here and no rule was written: the
        // evidence is the shipped file, so two bookmarks are enough and the
        // three-bookmark floor does not apply.
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ tag: 'dev', pattern: 'github.com' });
        expect(groups[0].reason).toEqual({ kind: 'catalogue', subject: 'dev' });
        expect(groups[0].keys.sort()).toEqual(['a', 'b']);
    });

    test('the catalogue speaks in the words you already use', async ({ page }) => {
        await open(page);
        const got = await page.evaluate((sets) => ({
            yours: window.TagSuggestions.suggest(sets.yours, { catalogue: sets.catalogue }),
            theirs: window.TagSuggestions.suggest(sets.theirs, { catalogue: sets.catalogue }),
        }), {
            catalogue: [{ tag: 'dev', aliases: ['code', 'programming'], hosts: ['github.com'] }],
            // #code is an alias of the catalogue's `dev`, and it is a word this
            // collection already uses -- on an unrelated site, so nothing about
            // github.com itself says it.
            yours: items([
                ['a', 'https://github.com/one', []],
                ['b', 'https://github.com/two', []],
                ['c', 'https://unrelated.example/x', ['code']],
            ]),
            theirs: items([
                ['a', 'https://github.com/one', []],
                ['b', 'https://github.com/two', []],
            ]),
        });
        expect(got.yours[0].tag).toBe('code');
        // Still accountable: the row says which subject it renamed.
        expect(got.yours[0].reason).toEqual({ kind: 'catalogue', subject: 'dev' });
        // Without that word in the collection, the catalogue's own stands.
        expect(got.theirs[0].tag).toBe('dev');
    });

    test('what you did yourself outranks the catalogue', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows, {
            catalogue: [{ tag: 'dev', aliases: [], hosts: ['github.com'] }],
        }), items([
            ['a', 'https://github.com/one', ['work']],
            ['b', 'https://github.com/two', ['work']],
            ['c', 'https://github.com/three', ['work']],
            ['d', 'https://github.com/four', []],
        ]));
        // The collection has settled github.com on #work, so the catalogue
        // says nothing about it -- offering #dev to all four would be the
        // shipped vocabulary splitting a tidy collection in two.
        expect(groups).toHaveLength(1);
        expect(groups[0].reason.kind).toBe('derived');
        expect(groups[0].tag).toBe('work');
    });

    test('the page text speaks for bookmarks nothing else can reach', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((sets) => window.TagSuggestions.suggest(sets.rows, {
            catalogue: sets.catalogue,
            keywords: sets.keywords,
        }), {
            catalogue: [{ tag: 'k8s', aliases: [], hosts: [], keywords: ['helm', 'etcd', 'kubelet'] }],
            // Three unrelated hosts, none of them in the catalogue: only what
            // the pages say about themselves is left.
            rows: items([
                ['a', 'https://blog.example/one', []],
                ['b', 'https://other.example/two', []],
                ['c', 'https://third.example/three', []],
            ]),
            keywords: { a: ['helm', 'etcd'], b: ['kubelet', 'helm'], c: ['helm'] },
        });
        expect(groups).toHaveLength(1);
        // Grouped by subject rather than by host: the two bookmarks are on
        // different sites, and a row each would say the same thing twice.
        expect(groups[0].pattern).toBe('page-text');
        expect(groups[0].keys.sort()).toEqual(['a', 'b']);
        expect(groups[0].reason.kind).toBe('text');
        // 'c' shares one word, which is a coincidence often enough to be
        // worthless -- two is the floor.
        expect(groups[0].keys).not.toContain('c');
    });

    test('a page that names the subject outright needs no second word', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((sets) => window.TagSuggestions.suggest(sets.rows, {
            catalogue: sets.catalogue,
            keywords: sets.keywords,
        }), {
            catalogue: [{ tag: 'diagramming', aliases: ['diagrams'], hosts: [], keywords: ['flowchart'] }],
            rows: items([
                ['a', 'https://unknown.example/one', []],
                ['b', 'https://unknown.example/two', []],
            ]),
            // 'a' writes the subject's own name; 'b' writes the reader's word
            // for it. Both have said what they are, so neither waits for a
            // second word -- while one loose keyword still would.
            keywords: { a: ['diagramming', 'teams'], b: ['diagrams'] },
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].reason.kind).toBe('text');
        expect(groups[0].keys.sort()).toEqual(['a', 'b']);
    });

    test('page text is the last word, not a second opinion', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((sets) => window.TagSuggestions.suggest(sets.rows, {
            rules: [{ pattern: 'ruled.example', tag: 'work' }],
            catalogue: sets.catalogue,
            keywords: sets.keywords,
        }), {
            catalogue: [{ tag: 'k8s', aliases: [], hosts: [], keywords: ['helm', 'etcd'] }],
            rows: items([['a', 'https://ruled.example/one', []]]),
            keywords: { a: ['helm', 'etcd'] },
        });
        // The rule already reached this bookmark, so the page text says
        // nothing: it is the guess of last resort.
        expect(groups).toHaveLength(1);
        expect(groups[0].reason.kind).toBe('rule');
    });

    test('a broken catalogue costs its own rows and nothing else', async ({ page }) => {
        await open(page);
        const got = await page.evaluate((rows) => ({
            missing: window.TagSuggestions.suggest(rows).length,
            rubbish: window.TagSuggestions.suggest(rows, { catalogue: 'not a list' }).length,
            halfBuilt: window.TagSuggestions.suggest(rows, {
                catalogue: [{ hosts: ['github.com'] }, { tag: 'dev' }, null],
            }).length,
        }), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        // The reader's own tags still produce their row in all three.
        expect(got.missing).toBe(1);
        expect(got.rubbish).toBe(1);
        expect(got.halfBuilt).toBe(1);
    });

    test('a rule that only restates a group the app already noticed is one row, not two', async ({ page }) => {
        await open(page);
        const groups = await page.evaluate((rows) => window.TagSuggestions.suggest(rows, {
            rules: [{ pattern: 'github.com', tag: 'code' }],
        }), items([
            ['a', 'https://github.com/one', ['code']],
            ['b', 'https://github.com/two', ['code']],
            ['c', 'https://github.com/three', ['code']],
            ['d', 'https://github.com/four', []],
        ]));
        // The rule and the pattern the app derived agree on tag and on
        // bookmark, so the reader is offered it once -- and the rule wins,
        // because it is the reason they would recognise.
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ tag: 'code', pattern: 'github.com', keys: ['d'] });
        expect(groups[0].reason).toEqual({ kind: 'rule' });
    });

    test('the biggest group is offered first, however specific the others are', async ({ page }) => {
        await open(page);
        const patterns = await page.evaluate((rows) => window.TagSuggestions.suggest(rows)
            .map((g) => `${g.pattern}:${g.keys.length}`), items([
            ['m1', 'https://many.example/one/a', ['code']],
            ['m2', 'https://many.example/two/a', ['code']],
            ['m3', 'https://many.example/three/a', ['code']],
            ['m4', 'https://many.example/four/a', []],
            ['m5', 'https://many.example/five/a', []],
            ['m6', 'https://many.example/six/a', []],
            ['m7', 'https://many.example/seven/a', []],
            ['m8', 'https://many.example/eight/a', []],
            ['s1', 'https://small.example/r/one', ['wiki']],
            ['s2', 'https://small.example/r/two', ['wiki']],
            ['s3', 'https://small.example/r/three', ['wiki']],
            ['s4', 'https://small.example/r/four', []],
            ['s5', 'https://small.example/r/five', []],
        ]));
        // The narrower small.example/r group still outranks the bare host for
        // resolving a conflict, but five bookmarks are worth reading before
        // two.
        expect(patterns).toEqual(['many.example:5', 'small.example/r:2']);
    });

    test('no bookmark is offered more than two tags', async ({ page }) => {
        await open(page);
        const perKey = await page.evaluate((rows) => {
            const groups = window.TagSuggestions.suggest(rows, {
                rules: [
                    { pattern: 'github.com', tag: 'one' },
                    { pattern: 'github.com', tag: 'two' },
                    { pattern: 'github.com', tag: 'three' },
                ],
            });
            const counts = {};
            groups.forEach((g) => g.keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
            return counts;
        }, items([['a', 'https://github.com/one', []]]));
        expect(perKey.a).toBe(2);
    });
});

test.describe('the suggestions panel', () => {
    test('offers a group, and applying it tags exactly those bookmarks', async ({ page }) => {
        await open(page);
        // dashboardInstance.config is a lazy-loading stub until the app has
        // finished wiring itself up; window.TagSuggestions loads eagerly and
        // much earlier, so open()'s wait alone is not enough here.
        await waitForConfigReady(page);
        // Four bookmarks on one host, three already tagged: the fourth is the
        // one the panel should offer to catch up.
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://plan.example/one', tags: ['code'] },
                { name: 'Two', url: 'https://plan.example/two', tags: ['code'] },
                { name: 'Three', url: 'https://plan.example/three', tags: ['code'] },
                { name: 'Four', url: 'https://plan.example/four', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });
        await openSuggestionsTab(page);
        const panel = page.locator('#config-bm-suggestions');

        const row = panel.locator('[data-tag-suggestion]').filter({ hasText: 'code' }).first();
        await expect(row).toContainText('plan.example');
        await row.locator('[data-tag-suggestion-apply]').click();

        const tagged = async () => page.evaluate(() =>
            (window.dashboardInstance.allBookmarks || [])
                .filter((b) => b.url.includes('plan.example') && (b.tags || []).includes('code')).length);
        await expect.poll(tagged, { timeout: 15_000 }).toBe(4);
        // Wait for the panel to catch up before undoing, so what it shows
        // afterwards is the undo's doing and not a repaint that had not landed.
        const offered = panel.locator('[data-tag-suggestion]').filter({ hasText: 'plan.example' });
        await expect(offered).toHaveCount(0, { timeout: 15_000 });

        // It went through the bulk path, so the toast's own Undo puts the
        // previous tags back -- the three that were already tagged stay tagged,
        // the fourth loses what the panel just gave it.
        const undo = page.locator('.app-notification.show .app-notification-action');
        await expect(undo).toBeVisible({ timeout: 15_000 });
        await undo.click();
        await expect.poll(tagged, { timeout: 15_000 }).toBe(3);

        // And the panel is offering plan.example again, rather than still
        // showing the collection as it was before the undo.
        await expect(offered).toHaveCount(1, { timeout: 15_000 });
    });

    test('every row shares one set of columns', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            // Hosts of deliberately different lengths: when each row was its
            // own grid, the long one moved that row's count and reason and
            // nothing else, so the column had as many left edges as it had
            // rows.
            const hosts = ['a.example', 'a-considerably-longer-hostname.example', 'mid.example'];
            for (const host of hosts) {
                for (let i = 0; i < 4; i += 1) {
                    await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            page: 1,
                            bookmark: { name: `${host} ${i}`, url: `https://${host}/p${i}`, tags: i < 3 ? ['wide'] : [] },
                        }),
                    });
                }
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
            // One row from a rule and the rest from your own tags, so the
            // reason column's own text is a different length per row too --
            // with a per-row grid that alone moves the columns around it.
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            await cfg.addTagRule('mid.example', 'ruled');
        });
        await openSuggestionsTab(page);
        await expect(page.locator('#config-bm-suggestions [data-tag-suggestion]').first())
            .toBeVisible({ timeout: 15_000 });

        const edges = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('[data-tag-suggestion]')];
            const lefts = (sel) => [...new Set(rows
                .map((row) => Math.round(row.querySelector(sel).getBoundingClientRect().left)))];
            return {
                rows: rows.length,
                tag: lefts('.config-suggestion-tag').length,
                count: lefts('.config-suggestion-count').length,
                actions: lefts('.config-suggestion-actions').length,
            };
        });
        expect(edges.rows).toBeGreaterThan(2);
        // One distinct edge per column, however long the host in that row is.
        expect(edges.tag).toBe(1);
        expect(edges.count).toBe(1);
        expect(edges.actions).toBe(1);
    });

    test('caps how many rows it draws, and says how many are waiting', async ({ page }) => {
        await open(page);
        await page.waitForFunction(() => !!window.ConfigTagSuggestions, null, { timeout: 15_000 });
        const drawn = await page.evaluate(() => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            // Thirty hosts, each three tagged and one not: thirty groups, more
            // than the panel is willing to put on screen at once.
            const rows = [];
            for (let h = 0; h < 30; h += 1) {
                for (let i = 0; i < 4; i += 1) {
                    rows.push({
                        key: `h${h}-${i}`,
                        url: `https://host${h}.example/page${i}`,
                        tags: i < 3 ? ['code'] : [],
                    });
                }
            }
            const groups = window.ConfigTagSuggestions.render(host, {
                items: rows, rules: [], t: (key, fallback) => fallback,
            });
            const notice = host.querySelector('[data-tag-suggestions-capped]');
            const result = {
                groups: groups.length,
                rows: host.querySelectorAll('[data-tag-suggestion]').length,
                notice: notice ? notice.textContent : '',
            };
            host.remove();
            return result;
        });
        expect(drawn.groups).toBe(30);
        expect(drawn.rows).toBe(25);
        expect(drawn.notice).toContain('25');
        expect(drawn.notice).toContain('30');
    });

    test('the shipped catalogue is served, and the panel reads it', async ({ page }) => {
        await open(page);
        const doc = await page.evaluate(async () => {
            const response = await fetch('/static/data/tag-patterns.json');
            return response.ok ? response.json() : null;
        });
        expect(doc?.version).toBe(1);
        expect(Array.isArray(doc.tags)).toBe(true);
        // Big enough to be worth shipping, and every entry usable: a subject
        // with no hosts can never match, and a host under two subjects would
        // propose whichever was read first.
        expect(doc.tags.length).toBeGreaterThan(300);
        const hosts = new Set();
        const twice = [];
        doc.tags.forEach((entry) => {
            expect(entry.hosts.length).toBeGreaterThan(0);
            expect(entry.aliases).not.toContain(entry.tag);
            entry.hosts.forEach((host) => {
                if (hosts.has(host)) twice.push(host);
                hosts.add(host);
            });
        });
        expect(twice).toEqual([]);

        // And it reaches the engine: a bookmark on a site the catalogue knows
        // is offered that site's subject.
        const proposed = await page.evaluate((catalogue) => window.TagSuggestions.suggest([
            { key: 'a', url: 'https://github.com/trending', tags: [] },
        ], { catalogue }).map((group) => group.tag), doc.tags);
        expect(proposed.length).toBe(1);
    });

    test('a proposal you turn down stays down, and comes back on request', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://refused.example/one', tags: ['code'] },
                { name: 'Two', url: 'https://refused.example/two', tags: ['code'] },
                { name: 'Three', url: 'https://refused.example/three', tags: ['code'] },
                { name: 'Four', url: 'https://refused.example/four', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });

        await openSuggestionsTab(page);
        const offered = page.locator('#config-bm-suggestions [data-tag-suggestion]')
            .filter({ hasText: 'refused.example' });
        await expect(offered).toHaveCount(1, { timeout: 15_000 });
        await offered.first().locator('[data-tag-suggestion-dismiss]').click();
        await expect(offered).toHaveCount(0, { timeout: 15_000 });

        // Recorded as pattern|tag, so it survives a reload and does not depend
        // on which bookmarks happened to be under it.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.settings.dismissedTagSuggestions || []),
        { timeout: 15_000 }).toContain('refused.example|code');
        await page.reload({ waitUntil: 'networkidle' });
        await waitForConfigReady(page);
        await openSuggestionsTab(page);
        await expect(page.locator('#config-bm-suggestions [data-tag-suggestion]')
            .filter({ hasText: 'refused.example' })).toHaveCount(0, { timeout: 15_000 });

        // And the line under the list takes it back -- the turned-down list is
        // folded away, so open it the way a reader would.
        await page.locator('[data-tag-suggestions-dismissed] > summary').click();
        await page.locator('[data-tag-suggestions-restore]').click();
        await expect(page.locator('#config-bm-suggestions [data-tag-suggestion]')
            .filter({ hasText: 'refused.example' })).toHaveCount(1, { timeout: 15_000 });
    });

    test('with nothing to propose it says so, and the rules tab stands on its own', async ({ page }) => {
        await open(page);
        await page.waitForFunction(() => !!window.ConfigTagSuggestions, null, { timeout: 15_000 });
        const drawn = await page.evaluate(() => {
            const panel = document.createElement('div');
            const rules = document.createElement('div');
            document.body.append(panel, rules);
            // One bookmark, no rules: the engine has nothing to say. The
            // editor is a tab of its own now, so the empty panel points at it
            // rather than carrying it.
            const groups = window.ConfigTagSuggestions.render(panel, {
                items: [{ key: 'a', url: 'https://alone.example/x', tags: [] }],
                rules: [],
                t: (key, fallback) => fallback,
            });
            window.ConfigTagSuggestions.renderRules(rules, {
                rules: [],
                t: (key, fallback) => fallback,
            });
            const result = {
                groups: groups.length,
                rows: panel.querySelectorAll('[data-tag-suggestion]').length,
                panelText: panel.textContent,
                editorInPanel: !!panel.querySelector('[data-tag-rule-add]'),
                addButton: !!rules.querySelector('[data-tag-rule-add]'),
                emptyNote: !!rules.querySelector('[data-tag-rules-empty]'),
                info: !!rules.querySelector('[data-tag-rules-info]'),
            };
            panel.remove();
            rules.remove();
            return result;
        });
        expect(drawn.groups).toBe(0);
        expect(drawn.rows).toBe(0);
        expect(drawn.panelText).toContain('Nothing to propose yet');
        expect(drawn.editorInPanel).toBe(false);
        expect(drawn.addButton).toBe(true);
        expect(drawn.emptyNote).toBe(true);
        expect(drawn.info).toBe(true);
    });

    test('applying a suggestion leaves the rows you ticked ticked', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://keep.example/one', tags: ['code'] },
                { name: 'Two', url: 'https://keep.example/two', tags: ['code'] },
                { name: 'Three', url: 'https://keep.example/three', tags: ['code'] },
                { name: 'Four', url: 'https://keep.example/four', tags: [] },
                { name: 'Other', url: 'https://elsewhere.example/x', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });
        // A tick on a bookmark the suggestion does not touch: the panel is
        // acting on its own group, not on the reader's selection.
        const ticked = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            const other = (window.dashboardInstance.allBookmarks || [])
                .find((b) => b.url.includes('elsewhere.example'));
            const key = cfg.bookmarkKey(other);
            cfg.bmSelected.add(key);
            return key;
        });

        await openSuggestionsTab(page);
        const row = page.locator('#config-bm-suggestions [data-tag-suggestion]')
            .filter({ hasText: 'keep.example' }).first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        await row.locator('[data-tag-suggestion-apply]').click();

        await expect.poll(() => page.evaluate(() =>
            (window.dashboardInstance.allBookmarks || [])
                .filter((b) => b.url.includes('keep.example') && (b.tags || []).includes('code')).length),
        { timeout: 15_000 }).toBe(4);

        expect(await page.evaluate((key) => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            return cfg.bmSelected.has(key);
        }, ticked)).toBe(true);
    });

    test('a rule you write lands under the form that wrote it', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await openRulesTab(page);
        const panel = page.locator('#config-bm-tag-rules');
        // Counted rather than assumed empty: the tests share one collection,
        // and an earlier one may have written a rule of its own.
        const before = await panel.locator('[data-tag-rule]').count();

        await panel.locator('[data-tag-rule-pattern]').fill('written.example');
        await panel.locator('[data-tag-rule-tag]').fill('reading');
        await panel.locator('[data-tag-rule-add]').click();

        const row = panel.locator('[data-tag-rule]').filter({ hasText: 'written.example' });
        await expect(row).toHaveCount(1, { timeout: 15_000 });
        await expect(panel.locator('[data-tag-rule]')).toHaveCount(before + 1, { timeout: 15_000 });

        // The form stays above what it produced: a reader with forty rules
        // should not scroll past forty to write the forty-first.
        const order = await panel.evaluate((el) => {
            const form = el.querySelector('.config-suggestion-row--form');
            const first = el.querySelector('[data-tag-rule]');
            if (!first) return 'form first';
            return form.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING ? 'form first' : 'list first';
        });
        expect(order).toBe('form first');

        await row.first().locator('[data-tag-rule-remove]').click();
        await expect(panel.locator('[data-tag-rule]')).toHaveCount(before, { timeout: 15_000 });
    });

    test('the info button explains the panel', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await openSuggestionsTab(page);
        await page.locator('#config-bm-suggestions [data-tag-suggestions-info]').click();
        // The same AppModal every other config info button opens.
        await expect(page.locator('.app-modal, .modal-overlay').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).toContainText('Apply', { timeout: 15_000 });

    });

    test('a pattern the server would drop is refused with a reason', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await openRulesTab(page);
        const panel = page.locator('#config-bm-tag-rules');

        const before = await page.evaluate(() =>
            (window.dashboardInstance.settings.tagRules || []).length);

        await panel.locator('[data-tag-rule-pattern]').fill('reddit.com/r/selfhosted');
        await panel.locator('[data-tag-rule-tag]').fill('homelab');
        await panel.locator('[data-tag-rule-add]').click();

        const error = panel.locator('[data-tag-rule-error]');
        await expect(error).toBeVisible({ timeout: 15_000 });
        await expect(error).toContainText('segment');
        // And nothing was written: sanitizeTagRules would have dropped it in
        // silence, which is the whole reason the message exists.
        expect(await page.evaluate(() =>
            (window.dashboardInstance.settings.tagRules || []).length)).toBe(before);
    });

    test('a rule you write survives a reload and proposes on its own', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config.writeFetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 1, bookmark: { name: 'X', url: 'https://ruled.example/x' } }),
            });
            const cfg = d.config?.instance || d.config;
            await cfg.addTagRule('ruled.example', 'work');
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => !!window.dashboardInstance?.settings, null, { timeout: 15_000 });

        const stored = await page.evaluate(() => window.dashboardInstance.settings.tagRules);
        expect(stored).toContainEqual({ pattern: 'ruled.example', tag: 'work' });

        await openSuggestionsTab(page);
        const row = page.locator('#config-bm-suggestions [data-tag-suggestion]').filter({ hasText: 'work' });
        await expect(row.first()).toBeVisible({ timeout: 15_000 });
    });

    /*
     * The number on the tab has to be the number in the tab.
     *
     * The catalogue and the scanned keywords used to load when the tab was
     * opened, so arriving on Bookmarks counted rules alone -- the strip said
     * "1", and opening it turned that into nineteen. A count that changes when
     * you look at it is worse than no count.
     */
    test('the tab count matches what the tab holds, before it is opened', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://counted.example/one', tags: ['count'] },
                { name: 'Two', url: 'https://counted.example/two', tags: ['count'] },
                { name: 'Three', url: 'https://counted.example/three', tags: ['count'] },
                { name: 'Four', url: 'https://counted.example/four', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });

        // Landing on the section, without touching the tab.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        const chip = page.locator('[data-bm-tab="tag-suggestions"] .config-subtab-count');
        await expect(chip).toBeVisible({ timeout: 15_000 });
        // Settled: the catalogue is fetched, so the number stops moving.
        await page.waitForFunction(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            return Array.isArray(cfg._tagCatalogue) && cfg._tagKeywords;
        }, null, { timeout: 15_000 });
        const before = Number(await chip.textContent());
        expect(before).toBeGreaterThan(0);

        await page.locator('[data-bm-tab="tag-suggestions"]').click();
        await expect(page.locator('#config-bm-suggestions')).toBeVisible({ timeout: 15_000 });
        const after = Number(await chip.textContent());
        const rows = await page.locator('#config-bm-suggestions [data-tag-suggestion]').count();

        expect(after).toBe(before);
        // And the number is the list's own length, not a second reckoning of it.
        expect(rows).toBe(Math.min(before, 25));
    });

    /*
     * "47 bookmarks" is a number to take on trust.
     *
     * A group with one wrong member left the reader nothing to do but refuse
     * the whole row and tag the other forty-six by hand. The count opens the
     * list, and what stays ticked is what Apply writes.
     */
    test('a group can be opened, and one bookmark left out of it', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const rows = [
                { name: 'One', url: 'https://opened.example/one', tags: ['open'] },
                { name: 'Two', url: 'https://opened.example/two', tags: ['open'] },
                { name: 'Three', url: 'https://opened.example/three', tags: ['open'] },
                { name: 'Spared', url: 'https://opened.example/spared', tags: [] },
                { name: 'Caught', url: 'https://opened.example/caught', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });
        await openSuggestionsTab(page);

        const row = page.locator('#config-bm-suggestions [data-tag-suggestion]')
            .filter({ hasText: 'opened.example' }).first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        await row.locator('[data-tag-suggestion-toggle]').click();

        const members = page.locator('#config-bm-suggestions [data-tag-suggestion-member]');
        await expect(members).toHaveCount(2, { timeout: 15_000 });
        // Named, not just counted.
        await expect(page.locator('#config-bm-suggestions .config-suggestion-members'))
            .toContainText('Spared');

        // Untick the one that does not belong, then accept the rest.
        const spared = page.locator('#config-bm-suggestions .config-suggestion-member')
            .filter({ hasText: 'Spared' }).locator('input');
        await spared.uncheck();
        await row.locator('[data-tag-suggestion-apply]').click();

        await expect.poll(() => page.evaluate(() => {
            const tagged = (window.dashboardInstance.allBookmarks || [])
                .filter((b) => b.url.includes('opened.example'));
            return {
                spared: (tagged.find((b) => b.name === 'Spared')?.tags || []).includes('open'),
                caught: (tagged.find((b) => b.name === 'Caught')?.tags || []).includes('open'),
            };
        }), { timeout: 15_000 }).toEqual({ spared: false, caught: true });
    });

    /*
     * One refusal at a time.
     *
     * The turned-down list was a count and a single "offer them again", so
     * wanting one proposal back meant taking every refusal back with it.
     */
    test('a turned-down proposal can be taken back on its own', async ({ page }) => {
        await open(page);
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            const rows = [
                { name: 'A', url: 'https://refuse-one.example/a', tags: ['keep'] },
                { name: 'B', url: 'https://refuse-one.example/b', tags: ['keep'] },
                { name: 'C', url: 'https://refuse-one.example/c', tags: ['keep'] },
                { name: 'D', url: 'https://refuse-one.example/d', tags: [] },
            ];
            for (const bookmark of rows) {
                await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: 1, bookmark }),
                });
            }
            await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(1);
        });
        await openSuggestionsTab(page);

        const offered = page.locator('#config-bm-suggestions [data-tag-suggestion]')
            .filter({ hasText: 'refuse-one.example' });
        await expect(offered).toHaveCount(1, { timeout: 15_000 });
        await offered.first().locator('[data-tag-suggestion-dismiss]').click();
        await expect(offered).toHaveCount(0, { timeout: 15_000 });

        // The turned-down list is folded away; open it the way a reader would.
        await page.locator('[data-tag-suggestions-dismissed] > summary').click();
        const refused = page.locator('[data-tag-suggestion-refused]')
            .filter({ hasText: 'refuse-one.example' });
        await expect(refused).toBeVisible({ timeout: 15_000 });
        await refused.locator('[data-tag-suggestion-restore-one]').click();

        await expect(offered).toHaveCount(1, { timeout: 15_000 });
        expect(await page.evaluate(() =>
            (window.dashboardInstance.settings.dismissedTagSuggestions || [])
                .filter((one) => one.includes('refuse-one.example')).length)).toBe(0);
    });
});

