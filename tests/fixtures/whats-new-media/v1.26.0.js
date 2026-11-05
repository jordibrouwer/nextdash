// The highlights of v1.26.0: the notifications bell and the large clock with a
// greeting by name. See tests/whats-new-media.spec.js.
const fs = require('fs');
const path = require('path');

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

/** A name for the greeting, in the classic header. */
function named(dir) {
    const file = path.join(dir, 'settings.json');
    writeJSON(file, { ...readJSON(file), greetingName: 'Jordi', headerClockPlacement: 'classic', showGridKeyLegend: false });
}

module.exports = {
    shots: [
        {
            slug: 'bell',
            kind: 'image',
            alt: 'The notifications bell open in the navigation bar, with two rows and a tip',
            dataTweak: { run: (dir) => writeJSON(path.join(dir, 'settings.json'), { ...readJSON(path.join(dir, 'settings.json')), showGridKeyLegend: false }) },
            // The bell's panel, with the bell above it.
            target: (page) => [page.locator('.notification-bell-panel, .notification-bell-popover').first(), page.locator('.notification-bell-button, #notification-bell').first()],
            async setup(page, { openDashboard }) {
                await openDashboard(page);
                await page.evaluate(() => {
                    try { localStorage.removeItem('nextdash-keyboard-tip-current'); localStorage.removeItem('nextdash-keyboard-tips-offered'); } catch { /* none */ }
                    window.dashboardInstance.settings.enableSessionTips = true;
                });
                await page.evaluate(() => window.DashboardKeyboardTip?.tick?.());
                await page.evaluate(() => window.NotificationBell.refreshAll());
                await page.evaluate(() => window.NotificationBell.open());
                await page.locator('.notification-bell-row').first().waitFor({ state: 'visible' });
                // Pacing for the capture, not a condition: the panel finishes sliding in.
                await page.waitForTimeout(800);
            },
        },
        {
            slug: 'greeting',
            kind: 'image',
            alt: 'The classic header with a large clock and the greeting Good evening beside it',
            dataTweak: { run: named },
            target: (page) => page.locator('#date-element'),
        },
    ],
};
