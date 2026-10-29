'use strict';

/**
 * The tag view's arithmetic, without a browser: which bookmarks a tag has,
 * what else they are tagged with, what they add up to, and how the rail, the
 * search and the sort narrow and order them.
 *
 * Run with: node tests/tag-view-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'shared', 'tag-view-model.js'), 'utf8'))();
const m = window.TagViewModel;

const b = (name, url, tags, extra = {}) => ({ name, url, tags, pageId: 1, openCount: 0, ...extra });
const pool = [
    b('Proxmox', 'https://pve.home/', ['homelab', 'docker'], { openCount: 41, lastOpened: 500 }),
    b('Portainer', 'https://portainer.home/', ['homelab', 'docker'], { openCount: 33, lastOpened: 400, pageId: 2 }),
    b('Grafana', 'https://grafana.home/', ['Homelab', 'monitoring'], { openCount: 0, lastOpened: 0 }),
    b('Proxmox', 'https://pve.home/', ['homelab'], { pageId: 3 }),
    b('Elsewhere', 'https://x.example/', ['news']),
];

// matches: any of the tags, first copy of a url|name wins.
{
    const list = m.matches(pool, ['homelab']);
    assert.deepStrictEqual(list.map((x) => x.name), ['Proxmox', 'Portainer', 'Grafana']);
    assert.strictEqual(list[0].pageId, 1);
    assert.deepStrictEqual(m.matches(pool, ['news', 'monitoring']).map((x) => x.name), ['Grafana', 'Elsewhere']);
    assert.deepStrictEqual(m.matches(pool, []), []);
    // mode 'all': only the bookmarks that carry every tag.
    assert.deepStrictEqual(m.matches(pool, ['homelab', 'docker'], { mode: 'all' }).map((x) => x.name), ['Proxmox', 'Portainer']);
    assert.deepStrictEqual(m.matches(pool, ['docker', 'monitoring'], { mode: 'all' }), []);
    assert.deepStrictEqual(m.matches(pool, ['docker', 'monitoring']).map((x) => x.name), ['Proxmox', 'Portainer', 'Grafana']);
}

// everything: every bookmark once, for #tags; untagged narrows to the ones without.
{
    const all = m.everything([...pool, b('Bare', 'https://bare.example/', [])]);
    assert.deepStrictEqual(all.map((x) => x.name), ['Proxmox', 'Portainer', 'Grafana', 'Elsewhere', 'Bare']);
    assert.deepStrictEqual(m.applyFilters(all, { untagged: true }).map((x) => x.name), ['Bare']);
    assert.strictEqual(m.hashFor([]), '#tags');
}

// related: other tags on the matches, by count then name, active ones left out.
{
    const list = m.matches(pool, ['homelab']);
    assert.deepStrictEqual(m.related(list, ['homelab']), [{ tag: 'docker', count: 2 }, { tag: 'monitoring', count: 1 }]);
    assert.deepStrictEqual(m.related(list, ['homelab', 'docker']), [{ tag: 'monitoring', count: 1 }]);
}

// stats.
{
    const list = m.matches(pool, ['homelab']);
    const s = m.stats(list, {
        scoreOf: (x) => ({ Proxmox: 100, Portainer: 90, Grafana: null }[x.name]),
        isBroken: (x) => x.name === 'Grafana',
    });
    assert.deepStrictEqual(
        { count: s.count, pages: s.pages, lastOpened: s.lastOpened, most: s.mostOpened.name, health: s.health, broken: s.broken },
        { count: 3, pages: 2, lastOpened: 500, most: 'Proxmox', health: 95, broken: 1 }
    );
    const empty = m.stats([]);
    assert.deepStrictEqual(
        { count: empty.count, pages: empty.pages, lastOpened: empty.lastOpened, mostOpened: empty.mostOpened, health: empty.health, broken: empty.broken },
        { count: 0, pages: 0, lastOpened: null, mostOpened: null, health: null, broken: 0 }
    );
}

// applyFilters: page, health, query, alone and together.
{
    const list = m.matches(pool, ['homelab']);
    const names = (xs) => xs.map((x) => x.name);
    assert.deepStrictEqual(names(m.applyFilters(list, { page: 2 })), ['Portainer']);
    assert.deepStrictEqual(names(m.applyFilters(list, { health: 'never' })), ['Grafana']);
    assert.deepStrictEqual(names(m.applyFilters(list, { health: 'broken', isBroken: (x) => x.name === 'Portainer' })), ['Portainer']);
    assert.deepStrictEqual(names(m.applyFilters(list, { query: 'PVE' })), ['Proxmox']);
    assert.deepStrictEqual(names(m.applyFilters(list, { query: 'graf' })), ['Grafana']);
    assert.deepStrictEqual(names(m.applyFilters(list, { page: 1, query: 'port' })), []);
    assert.deepStrictEqual(names(m.applyFilters(list, {})), names(list));
    // The search reads the tags too, and every word must match somewhere.
    assert.deepStrictEqual(names(m.applyFilters(list, { query: 'monitoring' })), ['Grafana']);
    assert.deepStrictEqual(names(m.applyFilters(list, { query: 'docker portainer' })), ['Portainer']);
    assert.deepStrictEqual(names(m.applyFilters(list, { query: '  grafana   monitoring ' })), ['Grafana']);
    assert.deepStrictEqual(names(m.applyFilters(list, { query: 'grafana docker' })), []);
}

// sort: every key, both directions, stable.
{
    const list = m.matches(pool, ['homelab']);
    const names = (xs) => xs.map((x) => x.name);
    assert.deepStrictEqual(names(m.sort(list)), ['Proxmox', 'Portainer', 'Grafana']);
    assert.deepStrictEqual(names(m.sort(list, 'lastOpened', 'asc')), ['Grafana', 'Portainer', 'Proxmox']);
    assert.deepStrictEqual(names(m.sort(list, 'name')), ['Grafana', 'Portainer', 'Proxmox']);
    assert.deepStrictEqual(names(m.sort(list, 'name', 'desc')), ['Proxmox', 'Portainer', 'Grafana']);
    assert.deepStrictEqual(names(m.sort(list, 'opens')), ['Proxmox', 'Portainer', 'Grafana']);
    assert.deepStrictEqual(names(m.sort(list, 'page')), ['Proxmox', 'Grafana', 'Portainer']);
    // Page follows the tabs' order, not the id; a page not in it goes last.
    assert.deepStrictEqual(names(m.sort(list, 'page', null, { pageOrder: [2, 1] })), ['Portainer', 'Proxmox', 'Grafana']);
    assert.deepStrictEqual(names(m.sort(list, 'page', 'desc', { pageOrder: [2, 1] })), ['Proxmox', 'Grafana', 'Portainer']);
    assert.deepStrictEqual(names(m.sort(list, 'page', null, { pageOrder: [1] })), ['Proxmox', 'Grafana', 'Portainer']);
    // Score: lowest first on asc, highest on desc; not checked yet last both ways.
    const scoreOf = (x) => ({ Proxmox: 100, Portainer: 60 }[x.name] ?? null);
    assert.deepStrictEqual(names(m.sort(list, 'score', null, { scoreOf })), ['Proxmox', 'Portainer', 'Grafana']);
    assert.deepStrictEqual(names(m.sort(list, 'score', 'asc', { scoreOf })), ['Portainer', 'Proxmox', 'Grafana']);
}

// hash round trip, with the characters a tag may hold.
for (const tags of [['homelab'], ['a+b', 'c'], ['c/d'], ['e f'], ['#g', 'h']]) {
    const hash = m.hashFor(tags);
    assert.ok(hash.startsWith('#tag/'), hash);
    assert.deepStrictEqual(m.tagsFromHash(hash), tags, hash);
}
assert.deepStrictEqual(m.tagsFromHash('#tag/a%2Bb+c'), ['a+b', 'c']);
assert.deepStrictEqual(m.tagsFromHash('tag/Homelab'), ['homelab']);
// ?all rides after the tags and is read back apart from them.
assert.strictEqual(m.hashFor(['a', 'b'], { mode: 'all' }), '#tag/a+b?all');
assert.strictEqual(m.hashFor(['a'], { mode: 'all' }), '#tag/a');
assert.deepStrictEqual(m.tagsFromHash('#tag/a+b?all'), ['a', 'b']);
assert.strictEqual(m.modeFromHash('#tag/a+b?all'), 'all');
assert.strictEqual(m.modeFromHash('#tag/a+b'), 'any');
assert.deepStrictEqual(m.tagsFromHash(m.hashFor(['what?', 'b'])), ['what?', 'b']);
assert.strictEqual(m.modeFromHash(m.hashFor(['what?all'])), 'any');

console.log('tag-view-model: ok');
