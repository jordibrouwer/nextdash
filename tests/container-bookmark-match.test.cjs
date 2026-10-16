'use strict';

/**
 * The browser's bookmarkFor over the same fixture the Go port is held to
 * (internal/app/testdata/container-bookmark-match.json).
 *
 * Run with: node tests/container-bookmark-match.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const cases = JSON.parse(fs.readFileSync(
    path.join(root, 'internal', 'app', 'testdata', 'container-bookmark-match.json'), 'utf8'));

function loadIndex(hosts) {
    // hosts[0] is the configured host address, hosts[1] the host the page was opened on.
    global.window = {
        location: { hostname: hosts[1] || hosts[0] },
        dashboardInstance: { settings: { dockerHostAddress: hosts[0] } },
    };
    const src = fs.readFileSync(
        path.join(root, 'static', 'js', 'dashboard', 'docker-search-index.js'), 'utf8');
    // eslint-disable-next-line no-eval
    eval(src);
    return global.window.DockerSearchIndex;
}

// The Go shape is flat ports; the browser's is {public, type}.
function browserContainer(c) {
    return {
        name: c.name,
        webui: c.webui,
        lanIP: c.lanIP,
        ports: (c.ports || []).map((p) => ({ public: p, type: 'tcp' })),
    };
}

if (require.main === module) {
    let failed = 0;
    for (const tc of cases) {
        try {
            const index = loadIndex(tc.hosts);
            const got = index.bookmarkFor(browserContainer(tc.container), tc.bookmarks, tc.links);
            const gotOut = got ? { key: index.bookmarkKey(got.bookmark), via: got.via } : null;
            assert.deepStrictEqual(gotOut, tc.want);
            console.log(`  ok   ${tc.name}`);
        } catch (err) {
            failed++;
            console.log(`  FAIL ${tc.name}`);
            console.log(`       ${err.message}`);
        }
    }
    console.log(`\n${cases.length - failed}/${cases.length} passed`);
    if (failed > 0) {
        throw new Error(`${failed} of ${cases.length} container match cases failed`);
    }
}
