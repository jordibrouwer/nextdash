// @ts-check
const { defineConfig } = require('@playwright/test');
const { prepareE2EDataDir } = require('./tests/playwright-data-env');

const skipServer = Boolean(process.env.PLAYWRIGHT_SKIP_SERVER);
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true';

if (!skipServer && !reuseExistingServer) {
    prepareE2EDataDir();
}

const { E2E_WEB_SERVER_ENV } = require('./tests/e2e-helpers');

// Default to 18080 so local Docker on :8080 does not shadow the test server.
const e2ePort = process.env.PORT || '18080';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
    testDir: 'tests',
    // Playwright's default testMatch takes `*.test.cjs` as well, and `tests/`
    // holds node unit tests by that name — plain scripts that assert at their
    // top level. Collected here they *run* while specs are being gathered, so
    // one failing assertion ends the whole e2e run before a spec starts, and a
    // process.exit() in one ends it reporting success. news-stream-model went
    // stale on 2026-08-29 and took every shard of CI down with it for a day,
    // which is the sort of thing a red suite is supposed to tell you.
    // Run them with `npm run test:news-stream` and friends.
    testMatch: /.*\.spec\.js$/,
    timeout: 60_000,
    // Deliberately false, and it is not about parallelism -- `workers: 1` below
    // already rules that out. It decides how `--shard` divides the suite: with
    // fullyParallel Playwright shards by individual test, so one spec file can
    // be split across several shards. tests/fixtures.js resets the store at
    // every *file* boundary, and specs build state across the tests within a
    // file, so a split file would reset in the middle of itself and throw away
    // what its earlier tests set up. False shards by file, which is the same
    // boundary the reset uses. It costs a little balance -- measured over the
    // 254 spec files, the heaviest of six shards runs about 8% over the mean --
    // and buys shards that cannot cut a file in half.
    fullyParallel: false,
    forbidOnly: isCI,
    retries: isCI ? 2 : 1,
    // One worker unless PW_WORKERS says otherwise. Above one, tests/fixtures.js
    // gives each worker its own server and data directory, which is what makes
    // more than one safe -- see worker-server.js.
    workers: Number(process.env.PW_WORKERS || 4),
    reporter: isCI ? [['github'], ['line']] : 'line',
    globalSetup: require.resolve('./tests/playwright-global-setup.js'),
    globalTeardown: require.resolve('./tests/playwright-global-teardown.js'),
    use: {
        baseURL,
        headless: true,
        trace: 'on-first-retry',
    },
    webServer: (skipServer || Number(process.env.PW_WORKERS || 4) > 1)
        ? undefined
        : {
            command: 'go run .',
            url: `${baseURL.replace(/\/$/, '')}/api/pages`,
            reuseExistingServer,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                ...process.env,
                ...E2E_WEB_SERVER_ENV,
                PORT: e2ePort,
            },
        },
});
