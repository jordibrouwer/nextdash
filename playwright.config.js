// @ts-check
const { defineConfig } = require('@playwright/test');
const { E2E_WEB_SERVER_ENV } = require('./tests/e2e-helpers');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080';
const isCI = Boolean(process.env.CI);
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true';

module.exports = defineConfig({
    testDir: 'tests',
    timeout: 30_000,
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 2 : 1,
    workers: 1,
    reporter: isCI ? [['github'], ['line']] : 'line',
    globalSetup: require.resolve('./tests/playwright-global-setup.js'),
    use: {
        baseURL,
        headless: true,
        trace: 'on-first-retry',
    },
    webServer: process.env.PLAYWRIGHT_SKIP_SERVER
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
            },
        },
});
