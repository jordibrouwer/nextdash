// The highlight of v1.20.1: the four Beszel widgets, on a page of their own.
// The hub's answers are mocked, as in tests/manual-screenshots.spec.js. See
// tests/whats-new-media.spec.js.
module.exports = {
    shots: [
        {
            slug: 'beszel-widgets',
            kind: 'image',
            alt: 'A page with four Beszel widgets: every system with its processor, memory and disk, one system in full with its processor over the last hour, the systems that need a look, and the fullest disks',
            viewport: { width: 1280, height: 1800 },
            dataPatch: 'beszel',
            // The four tiles, one box round them.
            target: (page) => ['beszel', 'beszel-system', 'beszel-attention', 'beszel-storage']
                .map((type) => page.locator(`[data-widget-type="${type}"]`).first()),
            async setup(page, { openDashboard, settle }) {
                const minute = 60_000;
                const now = Date.now();
                const open = (name) => `http://beszel.local:8090/system/${name}`;
                const sys = (id, title, meters, extra = {}) => ({ id, title, kind: 'system', openUrl: open(title), when: now - 14 * minute, meters, ...extra });
                const NAS = { status: 'up', cpu: 23, mem: 61, disk: 88.4, temp: 54, uptime: 41 * 86_400, agent: '0.21.0',
                    load: [1.2, 0.9, 0.8], net: 4_100_000, fs: [{ name: '/', pct: 88.4 }, { name: 'disk3', pct: 93 }] };
                const HTPC = { status: 'up', cpu: 91, mem: 55, disk: 40, temp: 71, uptime: 3 * 86_400, agent: '0.21.0', net: 52_000 };
                const PI = { status: 'up', cpu: 4, mem: 32, disk: 21, temp: 41, uptime: 88 * 86_400, agent: '0.20.0' };
                const counts = { up: 3, down: 1, paused: 0, pending: 0 };
                const libraries = [{ id: 's2', name: 'htpc' }, { id: 's1', name: 'nas' }, { id: 's4', name: 'pihole' }, { id: 's3', name: 'vps-01' }];
                const spark = Array.from({ length: 60 }, (_, i) => 14 + Math.round(18 * Math.abs(Math.sin(i / 6))) + (i % 5));
                const fsRow = (s, title, p, pct) => ({ id: `${s}:${p}`, title, subtitle: p, kind: 'fs', library: title, libraryId: s,
                    openUrl: open(title), meters: { status: 'up', disk: pct, fs: [{ name: p, pct }] } });
                const answers = {
                    beszel: { counts, items: [sys('s1', 'nas', NAS), sys('s2', 'htpc', HTPC), sys('s4', 'pihole', PI), sys('s3', 'vps-01', { status: 'down' })] },
                    'beszel-system': { counts: { up: 1, down: 0, paused: 0, pending: 0 }, items: [sys('s1', 'nas', { ...NAS, spark }, { subtitle: 'agent 0.21.0' })] },
                    'beszel-attention': { counts, items: [sys('s3', 'vps-01', { status: 'down' }, { subtitle: 'down' }),
                        sys('s2', 'htpc', HTPC, { subtitle: 'cpu 91% · 71°' }), sys('s1', 'nas', NAS, { subtitle: 'disk 88%' })] },
                    'beszel-storage': { counts, items: [fsRow('s1', 'nas', 'disk3', 93), fsRow('s1', 'nas', '/', 88.4), fsRow('s2', 'htpc', '/', 40), fsRow('s4', 'pihole', '/', 21)] },
                };
                for (const [type, answer] of Object.entries(answers)) {
                    await page.route(`**/api/widgets/${type}?**`, (route) => route.fulfill({ json: { fetchedAt: now, libraries, ...answer } }));
                }
                await openDashboard(page);
                // The patch adds the page last; #N counts tabs, not page ids.
                const last = await page.evaluate(() => window.dashboardInstance.pages.length);
                await openDashboard(page, `#${last}`);
                for (const type of Object.keys(answers)) await page.locator(`[data-widget-type="${type}"]`).first().waitFor();
                // Pacing for the capture, not a condition: the bars and the trend get time to be drawn.
                await page.waitForTimeout(1_000);
                await settle(page);
            },
        },
    ],
};
