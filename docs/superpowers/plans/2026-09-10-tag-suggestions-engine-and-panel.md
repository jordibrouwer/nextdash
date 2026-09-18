# Tag Suggestions — Engine and Review Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propose tags in bulk from what you already tagged and from rules you wrote, and let you apply a whole group in one click from Config → Bookmarks.

**Architecture:** A pure JS module groups bookmarks by host and by host plus first path segment, counts the tags already in use per group, and returns proposal groups. A panel in Config → Bookmarks renders those groups and applies an accepted one through the existing `mutateSelected` + `bulkUndo` path, so no new mutation code or endpoint is written. Rules you write live in `Settings.TagRules`, sanitised in Go beside `Collections`.

**Tech Stack:** Go 1.24 (stdlib plus gorilla/mux), vanilla JS (IIFE modules on `window`, no build step), Playwright for tests.

**Spec:** `docs/superpowers/specs/2026-09-10-bulk-tag-suggestions-design.md`

## Global Constraints

- **This plan is build step 1 of 4.** Sources in scope: your own rules, and derivation from your own tags. The catalogue (step 2), the page-text scan round (step 3), and the dashboard surface plus notice card (step 4) are out of scope here and get their own plans.
- **Nothing is applied without a click.** No auto-apply at any confidence.
- **No new mutation path.** Applying goes through `mutateSelected(picked, mutate)` and `bulkUndo(snapshots, …)` in `static/js/dashboard/dashboard-config.js`.
- **At most two proposals per bookmark.**
- **Tags are lowercase.** The server's `normalizeTags` (`internal/app/handlers.go:1471`) trims, lowercases and dedupes; the client must not propose anything that would change under it.
- **Six locale files in parity:** `locales/en.json`, `nl.json`, `de.json`, `fr.json`, `zh.json`, `es.json`. Translate — never copy the English string into another locale.
- **Every change gets a CHANGELOG.md line** under `## Unreleased`.
- **After changing anything under `static/`,** run `go run scripts/gen-asset-hashes.go`.
- **Playwright runs with two workers:** `PW_WORKERS=2 npx playwright test <file> --workers=2`. Write results to a file rather than piping to `tail`, which reports exit 0 over a failing run.

---

### Task 1: The suggestion engine

A pure module: no DOM, no knowledge of app structures. It takes items and returns proposal groups, which is what makes it portable to Go later.

**Files:**
- Create: `static/js/shared/tag-suggestions.js`
- Modify: `templates/dashboard.html` (script tag beside the other `js/shared/` modules, around line 22-24)
- Test: `tests/config-tag-suggestions.spec.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `window.TagSuggestions.patternsFor(url) → string[]`, `window.TagSuggestions.suggest(items, options) → group[]`.
  - `items`: `[{key: string, url: string, tags: string[]}]`
  - `options`: `{rules?: [{pattern, tag}], minGroup?: number, minShare?: number, maxPerBookmark?: number}` — defaults 3, 0.6, 2.
  - `group`: `{tag: string, pattern: string, source: 'rule'|'derived', reason: {kind: 'rule'} | {kind: 'derived', have: number, of: number}, keys: string[]}`

- [ ] **Step 1: Write the failing test**

Create `tests/config-tag-suggestions.spec.js`:

```javascript
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.TagSuggestions, null, { timeout: 15_000 });
}

const items = (rows) => rows.map(([key, url, tags]) => ({ key, url, tags: tags || [] }));

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
            tag: 'code', pattern: 'github.com', source: 'derived', keys: ['d'],
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
        expect(byTag.work.source).toBe('rule');
        expect(byTag.work.keys.sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(byTag.code.keys).toEqual(['d']);
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 > /tmp/ts1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/ts1.log
```

Expected: FAIL — `window.TagSuggestions` never becomes defined, so `waitForFunction` times out.

- [ ] **Step 3: Write the module**

Create `static/js/shared/tag-suggestions.js`:

```javascript
/**
 * What tags a bookmark could take, worked out from the ones you already gave
 * its neighbours.
 *
 * Pure on purpose: items in, groups out, no DOM and no knowledge of how the
 * app stores a bookmark. That is what lets the same rules run in the config
 * panel, on the dashboard, and — if the browser extension ever wants them —
 * in Go, without three implementations drifting apart.
 */
(function (global) {
    'use strict';

    const DEFAULTS = { minGroup: 3, minShare: 0.6, maxPerBookmark: 2 };

    /*
     * A URL becomes at most two patterns: the host, and the host with its
     * first path segment. One domain often carries several subjects --
     * reddit.com/r/selfhosted is not reddit.com/r/cooking -- and the segment
     * is where that difference lives. Anything deeper is a page rather than a
     * subject.
     */
    function patternsFor(url) {
        let parsed;
        try {
            parsed = new URL(String(url || ''));
        } catch (error) {
            return [];
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (!host) return [];
        const segment = parsed.pathname.split('/').filter(Boolean)[0];
        return segment ? [host, `${host}/${segment.toLowerCase()}`] : [host];
    }

    function tagsOf(item) {
        return Array.isArray(item.tags)
            ? item.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
            : [];
    }

    /** Every item that a pattern covers, keyed by that pattern. */
    function groupByPattern(items) {
        const byPattern = new Map();
        items.forEach((item) => {
            patternsFor(item.url).forEach((pattern) => {
                const bucket = byPattern.get(pattern) || [];
                bucket.push(item);
                byPattern.set(pattern, bucket);
            });
        });
        return byPattern;
    }

    /*
     * The tag a group agrees on, or nothing.
     *
     * Counted over the *tagged* members rather than all of them: a host where
     * three of thirty carry #code still says something about the three, and
     * demanding a majority of thirty would silence every group that has only
     * begun to be tagged.
     */
    function dominantTag(members, minShare) {
        const counts = new Map();
        let tagged = 0;
        members.forEach((item) => {
            const tags = tagsOf(item);
            if (!tags.length) return;
            tagged += 1;
            new Set(tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
        });
        if (tagged < 2) return null;
        let best = null;
        counts.forEach((count, tag) => {
            if (!best || count > best.have) best = { tag, have: count };
        });
        if (!best || best.have / tagged < minShare) return null;
        return { tag: best.tag, have: best.have, of: tagged };
    }

    function matchesPattern(item, pattern) {
        return patternsFor(item.url).includes(String(pattern || '').trim().toLowerCase());
    }

    /*
     * Proposals, most specific first.
     *
     * A rule is something you wrote down, so it outranks a pattern the app
     * merely noticed; and within what it noticed, host-plus-segment outranks
     * the bare host, because the narrower group is the better guess.
     */
    function suggest(items, options) {
        const settings = { ...DEFAULTS, ...(options || {}) };
        const rows = Array.isArray(items) ? items.filter((item) => item && item.key && item.url) : [];
        const proposals = [];

        (settings.rules || []).forEach((rule) => {
            const tag = String(rule.tag || '').trim().toLowerCase();
            const pattern = String(rule.pattern || '').trim().toLowerCase();
            if (!tag || !pattern) return;
            const keys = rows
                .filter((item) => matchesPattern(item, pattern) && !tagsOf(item).includes(tag))
                .map((item) => item.key);
            if (keys.length) {
                proposals.push({ tag, pattern, source: 'rule', reason: { kind: 'rule' }, keys, rank: 0 });
            }
        });

        groupByPattern(rows).forEach((members, pattern) => {
            if (members.length < settings.minGroup) return;
            const found = dominantTag(members, settings.minShare);
            if (!found) return;
            const keys = members
                .filter((item) => !tagsOf(item).includes(found.tag))
                .map((item) => item.key);
            if (!keys.length) return;
            proposals.push({
                tag: found.tag,
                pattern,
                source: 'derived',
                reason: { kind: 'derived', have: found.have, of: found.of },
                keys,
                rank: pattern.includes('/') ? 1 : 2,
            });
        });

        proposals.sort((a, b) => a.rank - b.rank || b.keys.length - a.keys.length);

        // The ceiling is per bookmark, not per group: three plausible tags on
        // one link is a review panel nobody finishes reading.
        const used = new Map();
        const groups = [];
        proposals.forEach((proposal) => {
            const keys = proposal.keys.filter((key) => (used.get(key) || 0) < settings.maxPerBookmark);
            if (!keys.length) return;
            keys.forEach((key) => used.set(key, (used.get(key) || 0) + 1));
            const { rank, ...group } = proposal;
            groups.push({ ...group, keys });
        });
        return groups;
    }

    global.TagSuggestions = { patternsFor, suggest };
})(window);
```

- [ ] **Step 4: Load the module**

In `templates/dashboard.html`, beside the other shared modules (after the `js/shared/clock-format.js` line):

```html
    <script src="{{asset "js/shared/tag-suggestions.js"}}"></script>
```

- [ ] **Step 5: Regenerate the asset hashes**

```bash
go run scripts/gen-asset-hashes.go && go build ./...
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 > /tmp/ts1.log 2>&1; echo "EXIT=$?"; grep -E "^ +[0-9]+ (failed|passed)" /tmp/ts1.log
```

Expected: `5 passed`.

- [ ] **Step 7: Commit**

```bash
git add static/js/shared/tag-suggestions.js templates/dashboard.html internal/app/asset_hashes_gen.go tests/config-tag-suggestions.spec.js
git commit -m "work out tag suggestions from the tags already in use"
```

---

### Task 2: Rules in Settings, sanitised in Go

**Files:**
- Modify: `internal/app/models.go` (add the type beside `Collection` at line 325-331; add the field beside `Collections` at line 576)
- Modify: `internal/app/handlers.go` (sanitise in `SaveSettings`, after the collections block that ends around line 2124)
- Test: `internal/app/settings_tag_rules_test.go`

**Interfaces:**
- Consumes: `normalizeTags` (`handlers.go:1471`).
- Produces: `TagRule{Pattern, Tag string}` with JSON keys `pattern` and `tag`; `Settings.TagRules []TagRule` with JSON key `tagRules`; `sanitizeTagRules(rules []TagRule) []TagRule`.

- [ ] **Step 1: Write the failing test**

Create `internal/app/settings_tag_rules_test.go`:

```go
package app

import "testing"

func TestSanitizeTagRulesKeepsWhatCanMatch(t *testing.T) {
	clean := sanitizeTagRules([]TagRule{
		{Pattern: "  GitHub.com  ", Tag: "  Code "},
		{Pattern: "reddit.com/r/selfhosted", Tag: "homelab"},
		{Pattern: "", Tag: "orphan"},
		{Pattern: "example.com", Tag: ""},
		{Pattern: "https://example.com", Tag: "scheme"},
		{Pattern: "github.com", Tag: "code"},
	})

	if len(clean) != 2 {
		t.Fatalf("kept %d rules: %#v", len(clean), clean)
	}
	// Trimmed and lowercased, so a rule matches what normalizeTags stores.
	if clean[0].Pattern != "github.com" || clean[0].Tag != "code" {
		t.Errorf("first rule = %#v", clean[0])
	}
	if clean[1].Pattern != "reddit.com/r/selfhosted" {
		t.Errorf("second rule = %#v", clean[1])
	}
}

func TestSanitizeTagRulesIsBounded(t *testing.T) {
	many := make([]TagRule, 0, 200)
	for i := 0; i < 200; i++ {
		many = append(many, TagRule{Pattern: "host" + string(rune('a'+i%26)) + ".example", Tag: "t"})
	}
	if got := len(sanitizeTagRules(many)); got > tagRulesMax {
		t.Errorf("kept %d rules, want at most %d", got, tagRulesMax)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
go test ./internal/app/... -run TestSanitizeTagRules -v 2>&1 | tail -5
```

Expected: FAIL — `undefined: sanitizeTagRules`, `undefined: TagRule`, `undefined: tagRulesMax`.

- [ ] **Step 3: Add the type and the field**

In `internal/app/models.go`, after the `Collection` struct (line 331):

```go
/*
TagRule is one thing you wrote down: this pattern means this tag.

Kept beside Collections because it is the same shape of setting -- a small
rule the reader owns -- but it is deliberately not a CollectionRule: a
collection filters a view, and this labels a bookmark.
*/
type TagRule struct {
	// Pattern is a host, or a host and its first path segment.
	Pattern string `json:"pattern"`
	Tag     string `json:"tag"`
}
```

In the `Settings` struct, after `Collections` (line 576):

```go
	TagRules                    []TagRule                  `json:"tagRules,omitempty"`          // Patterns you wrote that propose a tag
```

- [ ] **Step 4: Write the sanitiser**

In `internal/app/handlers.go`, after the collections sanitising block:

```go
// tagRulesMax bounds how many rules one install may keep. A reader with more
// than this is describing a taxonomy rather than correcting a few guesses.
const tagRulesMax = 100

/*
sanitizeTagRules keeps the rules that could ever match, and drops the rest.

A pattern is a host, optionally with its first path segment -- never a whole
address. A rule carrying a scheme looks configured and matches nothing, since
what it is compared against is already reduced to host and segment.
*/
func sanitizeTagRules(rules []TagRule) []TagRule {
	clean := make([]TagRule, 0, len(rules))
	seen := map[string]struct{}{}
	for _, rule := range rules {
		if len(clean) >= tagRulesMax {
			break
		}
		pattern := strings.ToLower(strings.TrimSpace(rule.Pattern))
		tags := normalizeTags([]string{rule.Tag})
		if pattern == "" || len(tags) == 0 {
			continue
		}
		if strings.Contains(pattern, "://") || strings.ContainsAny(pattern, " ?#") {
			continue
		}
		key := pattern + "\x00" + tags[0]
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		clean = append(clean, TagRule{Pattern: pattern, Tag: tags[0]})
	}
	return clean
}
```

Then call it in `SaveSettings`, beside where collections are narrowed:

```go
	settings.TagRules = sanitizeTagRules(settings.TagRules)
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
gofmt -w internal/app/models.go internal/app/handlers.go internal/app/settings_tag_rules_test.go
go test ./internal/app/... -run TestSanitizeTagRules -v 2>&1 | tail -5
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/app/models.go internal/app/handlers.go internal/app/settings_tag_rules_test.go
git commit -m "store the tag rules you write, and narrow them on save"
```

---

### Task 3: The review panel in Config → Bookmarks

**Files:**
- Create: `static/js/dashboard/dashboard-config-tag-suggestions.js`
- Modify: `templates/dashboard.html` (script tag beside `dashboard-config-bookmarks.js`)
- Modify: `static/js/dashboard/dashboard-config.js` (container in the bookmarks markup at 20444-20472; render call beside `renderBookmarkTagCloudSafe`; click binding beside `bindBookmarkTagCloud` at 20480)
- Modify: `static/css/config-view.css`
- Test: `tests/config-tag-suggestions.spec.js` (extend)

**Interfaces:**
- Consumes: `window.TagSuggestions.suggest` (Task 1); `Settings.TagRules` (Task 2); from `DashboardConfig`: `bookmarkKey(b)`, `dash.allBookmarks`, `mutateSelected(picked, mutate)`, `bulkUndo(snapshots, doneKey, doneFallback, failKey, failFallback)`, `notify(text, kind, opts)`, `t(key, fallback)`.
- Produces: `window.ConfigTagSuggestions.render(container, ctx) → group[]` where `ctx = {items, rules, t}` — it renders and hands back the groups it drew, and the click binding lives in `dashboard-config.js`; and `DashboardConfig.prototype.applyTagSuggestion(group)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/config-tag-suggestions.spec.js`:

```javascript
test.describe('the suggestions panel', () => {
    test('offers a group, and applying it tags exactly those bookmarks', async ({ page }) => {
        await open(page);
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
            await window.dashboardInstance.loadBookmarks?.();
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        const panel = page.locator('#config-bm-suggestions');
        await expect(panel).toBeVisible({ timeout: 15_000 });

        const row = panel.locator('[data-tag-suggestion]').filter({ hasText: 'code' }).first();
        await expect(row).toContainText('plan.example');
        await row.locator('[data-tag-suggestion-apply]').click();

        await expect.poll(async () => page.evaluate(() =>
            (window.dashboardInstance.allBookmarks || [])
                .filter((b) => b.url.includes('plan.example') && (b.tags || []).includes('code')).length),
        { timeout: 15_000 }).toBe(4);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 -g "offers a group" > /tmp/ts3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/ts3.log
```

Expected: FAIL — `#config-bm-suggestions` never becomes visible.

- [ ] **Step 3: Write the panel module**

Create `static/js/dashboard/dashboard-config-tag-suggestions.js`:

```javascript
/**
 * The review panel: what the engine proposes, and one button per group.
 *
 * Rendering only. It is handed items and rules and hands back the group the
 * reader accepted; applying is the config section's job, because that is
 * where the existing bulk path with its undo already lives.
 */
(function (global) {
    'use strict';

    function reasonText(t, group) {
        if (group.reason.kind === 'rule') return t('config.tagSuggestionReasonRule', 'your rule');
        return t('config.tagSuggestionReasonDerived', 'your own tags ({have} of {of})')
            .replace('{have}', String(group.reason.have))
            .replace('{of}', String(group.reason.of));
    }

    function render(container, ctx) {
        if (!container) return [];
        const t = ctx.t;
        const groups = global.TagSuggestions.suggest(ctx.items, { rules: ctx.rules });
        container.replaceChildren();
        if (!groups.length) {
            // Silence rather than an empty box: a panel that is always there
            // saying nothing is a panel people stop reading.
            container.hidden = true;
            return groups;
        }
        container.hidden = false;

        const title = document.createElement('h4');
        title.className = 'config-suggestions-title';
        title.textContent = t('config.tagSuggestionsTitle', 'Tag suggestions');
        container.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'config-suggestions-list';
        groups.forEach((group, index) => {
            const row = document.createElement('li');
            row.className = 'config-suggestion-row';
            row.setAttribute('data-tag-suggestion', String(index));

            const tag = document.createElement('span');
            tag.className = 'config-suggestion-tag';
            tag.textContent = `#${group.tag}`;

            const pattern = document.createElement('span');
            pattern.className = 'config-suggestion-pattern';
            pattern.textContent = group.pattern;

            const count = document.createElement('span');
            count.className = 'config-suggestion-count';
            count.textContent = t('config.tagSuggestionCount', '{n} bookmarks')
                .replace('{n}', String(group.keys.length));

            const why = document.createElement('span');
            why.className = 'config-suggestion-reason';
            why.textContent = reasonText(t, group);

            const apply = document.createElement('button');
            apply.type = 'button';
            apply.className = 'config-btn config-btn--small';
            apply.setAttribute('data-tag-suggestion-apply', String(index));
            apply.textContent = t('config.tagSuggestionApply', 'Apply');

            row.append(tag, pattern, count, why, apply);
            list.appendChild(row);
        });
        container.appendChild(list);
        return groups;
    }

    global.ConfigTagSuggestions = { render };
})(window);
```

- [ ] **Step 4: Mount it in the config section**

In `templates/dashboard.html`, beside `dashboard-config-bookmarks.js`:

```html
    <script src="{{asset "js/dashboard/dashboard-config-tag-suggestions.js"}}" defer></script>
```

In `static/js/dashboard/dashboard-config.js`, in the bookmarks markup between the tag cloud and `#config-bm-bulk`:

```javascript
                <div id="config-bm-suggestions" class="config-suggestions" hidden></div>
```

Add the methods to `DashboardConfig` (beside the other bookmark helpers):

```javascript
    /** What the engine needs: a key, an address and the tags it already has. */
    tagSuggestionItems() {
        return (this.dash.allBookmarks || []).map((b) => ({
            key: this.bookmarkKey(b),
            url: b.url,
            tags: Array.isArray(b.tags) ? b.tags : [],
        }));
    }

    renderTagSuggestionsSafe() {
        const container = document.getElementById('config-bm-suggestions');
        if (!container || !window.ConfigTagSuggestions) return;
        this._tagSuggestionGroups = window.ConfigTagSuggestions.render(container, {
            items: this.tagSuggestionItems(),
            rules: this.dash.settings?.tagRules || [],
            t: (key, fallback) => this.t(key, fallback),
        });
    }

    /*
     * Apply one accepted group.
     *
     * Through mutateSelected rather than through bulkTags: bulkTags reads the
     * tag and the mode out of the bulk bar's own inputs, which this panel does
     * not fill in. The undo, the snapshots and the page-by-page write are the
     * same either way.
     */
    async applyTagSuggestion(group) {
        if (!group?.tag || !Array.isArray(group.keys) || !group.keys.length) return;
        const wanted = new Set(group.keys);
        const picked = (this.dash.allBookmarks || []).filter((b) => wanted.has(this.bookmarkKey(b)));
        if (!picked.length) return;
        const snapshots = await this.mutateSelected(picked, (b) => {
            const current = Array.isArray(b.tags) ? b.tags.map((tag) => String(tag).toLowerCase()) : [];
            return { ...b, tags: [...new Set([...current, group.tag])] };
        });
        this.notify(this.t('config.tagSuggestionApplied', 'Tags added.'), 'success', {
            undoCallback: this.bulkUndo(snapshots, 'config.tagSuggestionUndone', 'Tags put back.',
                'config.bulkUndoFailed', 'Could not undo that.'),
            duration: 8000,
        });
        this.renderTagSuggestionsSafe();
    }
```

Call `this.renderTagSuggestionsSafe()` immediately after the existing `renderBookmarkTagCloudSafe()` call, and bind the button beside `bindBookmarkTagCloud`:

```javascript
        document.getElementById('config-bm-suggestions')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-tag-suggestion-apply]');
            if (!button) return;
            const index = Number(button.getAttribute('data-tag-suggestion-apply'));
            void this.applyTagSuggestion((this._tagSuggestionGroups || [])[index]);
        });
```

- [ ] **Step 5: Style it**

In `static/css/config-view.css`, beside the other `config-widget-field` rules:

```css
/* One line per proposal: the tag, what it matched, how many, and why. The
   reason is what makes a suggestion judgeable rather than merely offered. */
.config-suggestions-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.config-suggestion-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2, 0.5rem);
    padding: var(--space-1-5, 0.34rem) var(--space-2, 0.55rem);
}

.config-suggestion-pattern,
.config-suggestion-count,
.config-suggestion-reason {
    color: var(--text-muted, #888);
    font-size: calc(var(--font-size-text) * 0.86);
}

.config-suggestion-reason {
    margin-left: auto;
}
```

- [ ] **Step 6: Regenerate hashes and run the test**

```bash
go run scripts/gen-asset-hashes.go
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 > /tmp/ts3.log 2>&1; echo "EXIT=$?"; grep -E "^ +[0-9]+ (failed|passed)" /tmp/ts3.log
```

Expected: `6 passed`.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-config-tag-suggestions.js static/js/dashboard/dashboard-config.js static/css/config-view.css templates/dashboard.html internal/app/asset_hashes_gen.go tests/config-tag-suggestions.spec.js
git commit -m "show tag suggestions above the bulk bar, and apply one in a click"
```

---

### Task 4: Writing a rule of your own

**Files:**
- Modify: `static/js/dashboard/dashboard-config-tag-suggestions.js` (the editor)
- Modify: `static/js/dashboard/dashboard-config.js` (save through the settings path)
- Test: `tests/config-tag-suggestions.spec.js` (extend)

**Interfaces:**
- Consumes: `DashboardConfig.setBehavior(field, value, special)` for persistence, `renderTagSuggestionsSafe()` from Task 3.
- Produces: `DashboardConfig.prototype.addTagRule(pattern, tag)` and `removeTagRule(index)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/config-tag-suggestions.spec.js`:

```javascript
test('a rule you write survives a reload and proposes on its own', async ({ page }) => {
    await open(page);
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

    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    const row = page.locator('#config-bm-suggestions [data-tag-suggestion]').filter({ hasText: 'work' });
    await expect(row.first()).toBeVisible({ timeout: 15_000 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 -g "a rule you write" > /tmp/ts4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/ts4.log
```

Expected: FAIL — `cfg.addTagRule is not a function`.

- [ ] **Step 3: Add the rule methods**

In `static/js/dashboard/dashboard-config.js`, beside `applyTagSuggestion`:

```javascript
    /*
     * A rule is a setting, so it is written the way every other setting is.
     *
     * setBehavior already writes the value, records the change and leaves the
     * server to narrow it -- sanitizeTagRules drops a pattern carrying a
     * scheme rather than storing one that could never match.
     */
    async addTagRule(pattern, tag) {
        const cleanPattern = String(pattern || '').trim().toLowerCase();
        const cleanTag = String(tag || '').trim().toLowerCase();
        if (!cleanPattern || !cleanTag) return;
        const rules = [...(this.dash.settings?.tagRules || []), { pattern: cleanPattern, tag: cleanTag }];
        await this.setBehavior('tagRules', rules);
        this.renderTagSuggestionsSafe();
    }

    async removeTagRule(index) {
        const rules = [...(this.dash.settings?.tagRules || [])];
        if (index < 0 || index >= rules.length) return;
        rules.splice(index, 1);
        await this.setBehavior('tagRules', rules);
        this.renderTagSuggestionsSafe();
    }
```

- [ ] **Step 4: Add the editor to the panel**

In `static/js/dashboard/dashboard-config-tag-suggestions.js`, before `global.ConfigTagSuggestions = …`, add a renderer and call it at the end of `render` — and make `render` show the editor even when there are no groups, so a rule can be written before anything is proposed:

```javascript
    function renderRules(container, ctx) {
        const t = ctx.t;
        const wrap = document.createElement('div');
        wrap.className = 'config-suggestion-rules';

        const heading = document.createElement('h4');
        heading.className = 'config-suggestions-title';
        heading.textContent = t('config.tagRulesTitle', 'Your rules');
        wrap.appendChild(heading);

        (ctx.rules || []).forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'config-suggestion-row';
            const text = document.createElement('span');
            text.textContent = `${rule.pattern} → #${rule.tag}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'config-btn config-btn--small config-btn--danger';
            remove.setAttribute('data-tag-rule-remove', String(index));
            remove.textContent = t('config.tagRuleRemove', 'Remove');
            row.append(text, remove);
            wrap.appendChild(row);
        });

        const form = document.createElement('div');
        form.className = 'config-suggestion-row';
        const pattern = document.createElement('input');
        pattern.type = 'text';
        pattern.className = 'config-text';
        pattern.setAttribute('data-tag-rule-pattern', '');
        pattern.placeholder = t('config.tagRulePatternPlaceholder', 'github.com');
        const tag = document.createElement('input');
        tag.type = 'text';
        tag.className = 'config-text';
        tag.setAttribute('data-tag-rule-tag', '');
        tag.placeholder = t('config.tagRuleTagPlaceholder', 'code');
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'config-btn config-btn--small';
        add.setAttribute('data-tag-rule-add', '');
        add.textContent = t('config.tagRuleAdd', 'Add rule');
        form.append(pattern, tag, add);
        wrap.appendChild(form);
        container.appendChild(wrap);
    }
```

Replace the early return for the empty case so the editor still renders:

```javascript
        container.hidden = false;
        if (!groups.length) {
            const empty = document.createElement('p');
            empty.className = 'config-widget-field-hint';
            empty.textContent = t('config.tagSuggestionsEmpty',
                'Nothing to suggest yet — tag a few bookmarks and their neighbours will start proposing themselves.');
            container.appendChild(empty);
        }
```

Bind the two new controls beside the apply binding in `dashboard-config.js`:

```javascript
            const removeRule = event.target.closest('[data-tag-rule-remove]');
            if (removeRule) {
                void this.removeTagRule(Number(removeRule.getAttribute('data-tag-rule-remove')));
                return;
            }
            if (event.target.closest('[data-tag-rule-add]')) {
                const host = document.querySelector('[data-tag-rule-pattern]')?.value;
                const label = document.querySelector('[data-tag-rule-tag]')?.value;
                void this.addTagRule(host, label);
            }
```

- [ ] **Step 5: Regenerate hashes and run the whole spec**

```bash
go run scripts/gen-asset-hashes.go
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 > /tmp/ts4.log 2>&1; echo "EXIT=$?"; grep -E "^ +[0-9]+ (failed|passed)" /tmp/ts4.log
```

Expected: `7 passed`.

- [ ] **Step 6: Commit**

```bash
git add static/js/dashboard/dashboard-config-tag-suggestions.js static/js/dashboard/dashboard-config.js internal/app/asset_hashes_gen.go tests/config-tag-suggestions.spec.js
git commit -m "let a rule of your own propose a tag"
```

---

### Task 5: Wording in six languages, and the changelog

**Files:**
- Modify: `locales/en.json`, `locales/nl.json`, `locales/de.json`, `locales/fr.json`, `locales/zh.json`, `locales/es.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the key names used in Tasks 3 and 4.
- Produces: nothing further depends on this.

- [ ] **Step 1: Add the English strings**

In `locales/en.json`, in the `config` section beside the other bulk-action strings:

```json
    "tagSuggestionsTitle": "Tag suggestions",
    "tagSuggestionsEmpty": "Nothing to suggest yet — tag a few bookmarks and their neighbours will start proposing themselves.",
    "tagSuggestionApply": "Apply",
    "tagSuggestionCount": "{n} bookmarks",
    "tagSuggestionReasonRule": "your rule",
    "tagSuggestionReasonDerived": "your own tags ({have} of {of})",
    "tagSuggestionApplied": "Tags added.",
    "tagSuggestionUndone": "Tags put back.",
    "tagRulesTitle": "Your rules",
    "tagRuleAdd": "Add rule",
    "tagRuleRemove": "Remove",
    "tagRulePatternPlaceholder": "github.com",
    "tagRuleTagPlaceholder": "code",
```

- [ ] **Step 2: Add the other five, translated**

The two placeholders (`github.com`, `code`) stay as they are in every locale — they are examples of what you type, not prose. `{n}`, `{have}` and `{of}` stay intact.

`locales/nl.json`:

```json
    "tagSuggestionsTitle": "Tagsuggesties",
    "tagSuggestionsEmpty": "Nog niets voor te stellen — tag een paar bladwijzers, dan gaan hun buren zichzelf aandragen.",
    "tagSuggestionApply": "Toepassen",
    "tagSuggestionCount": "{n} bladwijzers",
    "tagSuggestionReasonRule": "jouw regel",
    "tagSuggestionReasonDerived": "je eigen tags ({have} van {of})",
    "tagSuggestionApplied": "Tags toegevoegd.",
    "tagSuggestionUndone": "Tags teruggezet.",
    "tagRulesTitle": "Jouw regels",
    "tagRuleAdd": "Regel toevoegen",
    "tagRuleRemove": "Verwijderen",
    "tagRulePatternPlaceholder": "github.com",
    "tagRuleTagPlaceholder": "code",
```

`locales/de.json`:

```json
    "tagSuggestionsTitle": "Tag-Vorschläge",
    "tagSuggestionsEmpty": "Noch nichts vorzuschlagen — vergib ein paar Tags, dann melden sich die Nachbarn von selbst.",
    "tagSuggestionApply": "Anwenden",
    "tagSuggestionCount": "{n} Lesezeichen",
    "tagSuggestionReasonRule": "deine Regel",
    "tagSuggestionReasonDerived": "deine eigenen Tags ({have} von {of})",
    "tagSuggestionApplied": "Tags hinzugefügt.",
    "tagSuggestionUndone": "Tags zurückgesetzt.",
    "tagRulesTitle": "Deine Regeln",
    "tagRuleAdd": "Regel hinzufügen",
    "tagRuleRemove": "Entfernen",
    "tagRulePatternPlaceholder": "github.com",
    "tagRuleTagPlaceholder": "code",
```

`locales/fr.json`:

```json
    "tagSuggestionsTitle": "Suggestions d’étiquettes",
    "tagSuggestionsEmpty": "Rien à proposer pour l’instant — étiquetez quelques favoris et leurs voisins se proposeront d’eux-mêmes.",
    "tagSuggestionApply": "Appliquer",
    "tagSuggestionCount": "{n} favoris",
    "tagSuggestionReasonRule": "votre règle",
    "tagSuggestionReasonDerived": "vos propres étiquettes ({have} sur {of})",
    "tagSuggestionApplied": "Étiquettes ajoutées.",
    "tagSuggestionUndone": "Étiquettes rétablies.",
    "tagRulesTitle": "Vos règles",
    "tagRuleAdd": "Ajouter une règle",
    "tagRuleRemove": "Supprimer",
    "tagRulePatternPlaceholder": "github.com",
    "tagRuleTagPlaceholder": "code",
```

`locales/es.json`:

```json
    "tagSuggestionsTitle": "Sugerencias de etiquetas",
    "tagSuggestionsEmpty": "Nada que sugerir todavía: etiqueta unos cuantos marcadores y sus vecinos empezarán a proponerse solos.",
    "tagSuggestionApply": "Aplicar",
    "tagSuggestionCount": "{n} marcadores",
    "tagSuggestionReasonRule": "tu regla",
    "tagSuggestionReasonDerived": "tus propias etiquetas ({have} de {of})",
    "tagSuggestionApplied": "Etiquetas añadidas.",
    "tagSuggestionUndone": "Etiquetas restauradas.",
    "tagRulesTitle": "Tus reglas",
    "tagRuleAdd": "Añadir regla",
    "tagRuleRemove": "Quitar",
    "tagRulePatternPlaceholder": "github.com",
    "tagRuleTagPlaceholder": "code",
```

`locales/zh.json`:

```json
    "tagSuggestionsTitle": "标签建议",
    "tagSuggestionsEmpty": "暂时没有可建议的内容——先给几个书签打上标签，同一站点的其他书签就会自己冒出来。",
    "tagSuggestionApply": "应用",
    "tagSuggestionCount": "{n} 个书签",
    "tagSuggestionReasonRule": "你的规则",
    "tagSuggestionReasonDerived": "你自己的标签（{of} 个中有 {have} 个）",
    "tagSuggestionApplied": "已添加标签。",
    "tagSuggestionUndone": "标签已还原。",
    "tagRulesTitle": "你的规则",
    "tagRuleAdd": "添加规则",
    "tagRuleRemove": "移除",
    "tagRulePatternPlaceholder": "github.com",
    "tagRuleTagPlaceholder": "code",
```

- [ ] **Step 3: Verify parity**

```bash
for s in validate:json validate:locale-parity validate:locale-placeholders; do printf "%-30s" "$s"; npm run --silent $s > /tmp/v.log 2>&1 && echo PASS || { echo FAIL; tail -6 /tmp/v.log; }; done
```

Expected: three PASS lines.

- [ ] **Step 4: Add the changelog line**

Under `## Unreleased` in `CHANGELOG.md`, in a `### Config` group:

```markdown
- **new — Config → Bookmarks proposes tags in bulk, from the tags you already gave a host's other bookmarks.** A new pure module (`static/js/shared/tag-suggestions.js`) groups bookmarks by host and by host plus first path segment, finds the tag a group agrees on — counted over its *tagged* members, so a host that is only half sorted still says something — and offers it to the ones lacking it, at most two proposals per bookmark. Every row names its source, because a suggestion you cannot account for is one you cannot judge. Rules of your own (`Settings.TagRules`, narrowed by `sanitizeTagRules`) outrank what the app noticed. Applying goes through the existing `mutateSelected` + `bulkUndo` path rather than a new endpoint, so the 8-second undo works exactly as it does for the bulk bar.
```

- [ ] **Step 5: Run the full spec once more and commit**

```bash
PW_WORKERS=2 npx playwright test tests/config-tag-suggestions.spec.js --workers=2 > /tmp/ts5.log 2>&1; echo "EXIT=$?"; grep -E "^ +[0-9]+ (failed|passed)" /tmp/ts5.log
git add locales/*.json CHANGELOG.md
git commit -m "name the tag suggestion panel in six languages"
```

---

## What this plan does not build

Per the spec's build order, each of these gets its own plan once this one is in:

2. **The catalogue** — `static/data/tag-patterns.json`, roughly 500 tags with their aliases, hosts and keywords, turning on the host half of source 3.
3. **The scan round** — `POST/GET /api/tags/scan`, keyword extraction in `preview_metadata.go`, the `keywords` field on the preview cache, turning on source 4.
4. **The dashboard surface and the notice card** — multi-select suggestions, `tag-suggestions-notice` through `NoticeCard.define()`, the modal, and the two Behavior → General → Onboarding toggles (`enableTagSuggestionNotice`, `enableHealthReviewNotice`, both defaulting to on with the absent-key backfill).
