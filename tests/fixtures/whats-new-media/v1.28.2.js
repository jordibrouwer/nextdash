// The highlights of v1.28.2. The theme-groups picture is a collage of eight
// dashboards, made outside this spec; the recording below is the page margins
// moving through their steps. See tests/whats-new-media.spec.js.
// The same write the palette's :margins and :columns make, without the
// palette over the page: it blurs what the recording is about.
async function setting(page, margin, columns) {
    await page.evaluate(async ([m, c]) => {
        const d = window.dashboardInstance;
        d.settings.sideMargin = m;
        if (c) d.settings.columnsPerRow = c;
        document.body.setAttribute('data-side-margin', m);
        await d.renderDashboard({ animate: false });
        d.saveSettings?.();
    }, [margin, columns]);
}

module.exports = {
    shots: [
        {
            slug: 'page-margins',
            kind: 'video',
            alt: 'The dashboard with six columns, its page margins moving from Full width through Balanced to Spacious',
            viewport: { width: 1700, height: 900 },
            async setup(page, kit) {
                await kit.openDashboard(page);
                await setting(page, 'full', 6);
                // Pacing for the capture, not a condition: the page finishes laying out.
                await page.waitForTimeout(800);
            },
            async act(page) {
                for (const step of ['tight', 'balanced', 'airy', 'spacious']) {
                    await page.waitForTimeout(1_100);
                    await setting(page, step);
                }
                await page.waitForTimeout(600);
            },
        },
    ],
};
