// @ts-check
const { cleanupE2EDataDir } = require('./playwright-data-env');

/** @returns {Promise<void>} */
module.exports = async function globalTeardown() {
    cleanupE2EDataDir();
};
