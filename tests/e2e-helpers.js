// @ts-check
/** Shared Playwright e2e settings (write token, webServer env). */

const WRITE_TOKEN = process.env.NEXTDASH_WRITE_TOKEN || 'playwright-e2e-write-token';

/** Env vars for the Playwright-managed `go run .` server. */
const E2E_WEB_SERVER_ENV = {
    NEXTDASH_WRITE_TOKEN: WRITE_TOKEN,
};

module.exports = {
    WRITE_TOKEN,
    E2E_WEB_SERVER_ENV,
};
