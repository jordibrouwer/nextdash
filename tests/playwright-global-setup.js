// @ts-check
const { binaryPath } = require('./worker-server');
/**
 * Validates a reused dev server before Playwright skips webServer startup.
 * Playwright-managed runs (default) start a fresh `go run .` process instead.
 */
async function assertNextDashServerHealthy(baseURL) {
    const healthUrl = `${baseURL.replace(/\/$/, '')}/api/pages`;
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
            if (!response.ok) {
                throw new Error(`GET ${healthUrl} returned HTTP ${response.status}`);
            }
            const body = await response.json();
            if (!Array.isArray(body)) {
                throw new Error(`GET ${healthUrl} did not return a JSON array`);
            }
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
    }

    throw new Error(
        `nextDash server at ${baseURL} is not healthy (${lastError?.message || 'unknown error'}). `
        + 'Stop any stale process on port 8080 or unset PLAYWRIGHT_REUSE_SERVER so Playwright starts a fresh server.',
    );
}

/**
 * Build the server once, for the per-worker servers to spawn.
 *
 * `go run .` compiles into a temp directory and would do it per worker; one
 * `go build` up front costs a few seconds and saves that every time.
 * @returns {Promise<void>}
 */
async function buildServerBinary() {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const target = binaryPath();
    await promisify(execFile)('go', ['build', '-o', target, '.'], {
        cwd: require('path').join(__dirname, '..'),
        timeout: 600_000,
    });
}

/** @returns {Promise<void>} */
module.exports = async function globalSetup() {
    if (Number(process.env.PW_WORKERS || 1) > 1) {
        await buildServerBinary();
        return;
    }
    if (process.env.PLAYWRIGHT_SKIP_SERVER) {
        return;
    }
    if (process.env.PLAYWRIGHT_REUSE_SERVER !== 'true') {
        return;
    }

    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080';
    await assertNextDashServerHealthy(baseURL);
};
