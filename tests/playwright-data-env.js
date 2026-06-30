// @ts-check
const fs = require('fs');
const path = require('path');
const os = require('os');

const MANAGED_FLAG = 'PLAYWRIGHT_MANAGED_DATA_DIR';

/**
 * Fresh temp data dir for Playwright-managed `go run .` (isolated from ./data).
 * Skipped when NEXTDASH_DATA_DIR is already set or PLAYWRIGHT_REUSE_SERVER is used.
 * @returns {string | undefined}
 */
function prepareE2EDataDir() {
    if (process.env.NEXTDASH_DATA_DIR) {
        return process.env.NEXTDASH_DATA_DIR;
    }
    const dir = path.join(os.tmpdir(), `nextdash-e2e-${process.pid}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    process.env.NEXTDASH_DATA_DIR = dir;
    process.env[MANAGED_FLAG] = '1';
    return dir;
}

/** Remove temp dir created by prepareE2EDataDir(). */
function cleanupE2EDataDir() {
    if (process.env[MANAGED_FLAG] !== '1') {
        return;
    }
    const dir = process.env.NEXTDASH_DATA_DIR;
    if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    delete process.env[MANAGED_FLAG];
}

module.exports = { prepareE2EDataDir, cleanupE2EDataDir };
