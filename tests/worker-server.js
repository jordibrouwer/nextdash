// @ts-check
/**
 * One nextDash server per Playwright worker.
 *
 * The suite used to run against a single `go run .` and a single data
 * directory, which is why playwright.config.js pinned `workers: 1`: two
 * workers sharing one store would delete each other's bookmarks halfway
 * through a test. That cap is what made a full run take about an hour and a
 * half, and it is also why CI had to be sharded across six machines to get
 * under twenty minutes.
 *
 * Giving every worker its own server and its own data directory removes the
 * reason for the cap. A worker gets:
 *
 *   - its own port, 18080 + workerIndex
 *   - its own data directory, removed when the worker exits
 *   - its own process, started from a binary built once in global setup
 *
 * Nothing is shared, so the workers cannot interfere with each other, and the
 * per-spec-file reset in fixtures.js keeps doing its job inside each one.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_PORT = Number(process.env.E2E_BASE_PORT || 18080);

/** Where global setup leaves the compiled server. */
function binaryPath() {
    return process.env.E2E_SERVER_BINARY || path.join(os.tmpdir(), 'nextdash-e2e-server');
}

/**
 * Wait until the server answers, or give up.
 * @param {string} baseURL
 * @param {number} timeoutMs
 */
async function waitForServer(baseURL, timeoutMs = 60_000) {
    const url = `${baseURL}/api/pages`;
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) {
                return;
            }
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`server at ${baseURL} did not come up: ${lastError?.message || 'timeout'}`);
}

/**
 * Start a server for one worker.
 * @param {number} workerIndex
 * @param {Record<string, string>} env
 * @returns {Promise<{ baseURL: string, stop: () => Promise<void> }>}
 */
async function startWorkerServer(workerIndex, env) {
    const port = BASE_PORT + workerIndex;
    const baseURL = `http://localhost:${port}`;
    const dataDir = path.join(os.tmpdir(), `nextdash-e2e-w${workerIndex}-${process.pid}`);

    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const child = spawn(binaryPath(), [], {
        env: { ...process.env, ...env, PORT: String(port), NEXTDASH_DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString().slice(0, 2000); });
    child.stderr.on('data', (chunk) => { output += chunk.toString().slice(0, 2000); });

    const exited = new Promise((_, reject) => {
        child.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                reject(new Error(`worker ${workerIndex} server exited with ${code}:\n${output.slice(-1000)}`));
            }
        });
    });

    await Promise.race([waitForServer(baseURL), exited]);

    return {
        baseURL,
        async stop() {
            child.kill('SIGTERM');
            await new Promise((resolve) => {
                const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(undefined); }, 5_000);
                child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
            });
            fs.rmSync(dataDir, { recursive: true, force: true });
        },
    };
}

module.exports = { startWorkerServer, binaryPath };
