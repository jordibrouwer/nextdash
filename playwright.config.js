// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: 'tests',
    timeout: 30_000,
    workers: 3,
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080',
        headless: true,
    },
    webServer: process.env.PLAYWRIGHT_SKIP_SERVER
        ? undefined
        : {
            command: 'go run .',
            url: 'http://localhost:8080',
            reuseExistingServer: true,
            timeout: 120_000,
        },
});
