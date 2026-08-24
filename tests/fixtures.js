// @ts-check
/**
 * The `test` object every spec imports.
 *
 * Playwright runs the whole suite against one `go run .` and one data
 * directory (see prepareE2EDataDir in playwright-data-env.js and the webServer
 * block in playwright.config.js). That is deliberate — the specs are written
 * against a real server, not a mock — but it means the store carries whatever
 * the previous spec file left in it, and a test that reads "the third
 * category" or "the first bookmark row" quietly starts describing a different
 * thing depending on what ran before it.
 *
 * It showed up as tests that pass on their own and fail in a full run:
 * dashboard-category-spacing fails once when run alone and four times when run
 * after a handful of other files, and the CI run that reported 25 failures in
 * dashboard-inbox.spec.js passes 26 of 27 when that file is run by itself.
 *
 * So: the store goes back to a fresh install at the start of every spec file.
 * Not before every *test* — specs routinely build state across the tests in a
 * file, and their own beforeEach hooks own that. The boundary that was never
 * anybody's responsibility is the one between files.
 *
 * Import this instead of '@playwright/test' and nothing else changes; `test`
 * and `expect` behave exactly as before.
 */

const base = require('@playwright/test');
const { WRITE_TOKEN, E2E_WEB_SERVER_ENV } = require('./e2e-helpers');
const { startWorkerServer } = require('./worker-server');

/**
 * More than one worker means one server per worker (see worker-server.js).
 * Without it nothing changes: the config's webServer block starts the single
 * server it always did, and this file behaves exactly as before.
 */
const workersRequested = Number(process.env.PW_WORKERS || 1);
const perWorkerServer = workersRequested > 1;

/** Last spec file each worker ran, so the reset fires once per file. */
const lastFileByWorker = new Map();

/**
 * Put the server's store back to a fresh install.
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function resetStore(request) {
    const response = await request.post('/api/reset', {
        data: { confirm: true },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    if (!response.ok()) {
        throw new Error(
            `resetting the store between spec files failed: HTTP ${response.status()} `
            + `— ${(await response.text()).slice(0, 200)}`,
        );
    }
}

const test = base.test.extend({
    /**
     * The server this worker talks to. Worker-scoped: started once when the
     * worker begins and stopped when it ends, not per test.
     */
    workerServer: [async ({}, use, workerInfo) => {
        if (!perWorkerServer) {
            await use(null);
            return;
        }
        const server = await startWorkerServer(workerInfo.workerIndex, E2E_WEB_SERVER_ENV);
        await use(server);
        await server.stop();
    }, { scope: 'worker' }],

    /**
     * Point every relative page.goto() and request at this worker's own server.
     * Falls through to whatever the config set when running single-worker.
     */
    baseURL: async ({ workerServer }, use) => {
        await use(workerServer ? workerServer.baseURL : (process.env.PLAYWRIGHT_BASE_URL
            || `http://localhost:${process.env.PORT || '18080'}`));
    },

    /**
     * Auto fixture: resets the store when the worker moves to a new spec file.
     *
     * Test-scoped rather than worker-scoped because a worker runs several
     * files, and file boundaries are what we care about. It runs after a
     * file's beforeAll hooks, which is safe here: the two specs that use
     * beforeAll do not seed the server from it.
     */
    freshStorePerSpecFile: [async ({ request }, use, testInfo) => {
        if (lastFileByWorker.get(testInfo.workerIndex) !== testInfo.file) {
            lastFileByWorker.set(testInfo.workerIndex, testInfo.file);
            await resetStore(request);
        }
        await use(undefined);
    }, { auto: true }],
});

module.exports = { ...base, test, expect: base.expect };
