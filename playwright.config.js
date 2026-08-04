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
    timeout: 30_000,
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 1,
    workers: 1,
    reporter: isCI ? [['github'], ['line']] : 'line',
    globalSetup: require.resolve('./tests/playwright-global-setup.js'),
    globalTeardown: require.resolve('./tests/playwright-global-teardown.js'),
    use: {
        baseURL,
        headless: true,
        trace: 'on-first-retry',
    },
    webServer: skipServer
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
