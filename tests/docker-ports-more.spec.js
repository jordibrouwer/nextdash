// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * A container that publishes many ports shows the first three and "+N"; the
 * rest open in a popover, so the row stays one line. A port published for
 * tcp and udp counts once in the row and is named twice in the popover.
 */

const QBIT = {
    id: 'q'.repeat(64), shortId: 'q'.repeat(12), name: 'qbittorrent', image: 'binhex/arch-qbittorrentvpn', tag: 'latest',
    state: 'running', status: 'Up 2 hours', health: '', created: 1790000000,
    ports: [
        { private: 9118, public: 9118, type: 'tcp' },
        { private: 58946, public: 58946, type: 'tcp' },
        { private: 58946, public: 58946, type: 'udp' },
        { private: 8080, public: 8080, type: 'tcp' },
        { private: 8118, public: 8118, type: 'tcp' },
        { private: 6881, public: 6881, type: 'tcp' },
    ],
};
const SONARR = {
    id: 'a'.repeat(64), shortId: 'a'.repeat(12), name: 'sonarr', image: 'linuxserver/sonarr', tag: 'latest',
    state: 'running', status: 'Up', health: '', created: 1790000000, ports: [{ private: 8989, public: 8989, type: 'tcp' }],
};

test.describe('many ports', () => {
    test('three in the row, the rest behind +N', async ({ page }) => {
        await mockDocker(page, { containers: [QBIT, SONARR] });
        await page.goto('/#docker');
        const cell = page.locator('[data-docker-row="qbittorrent"] .docker-cell--ports');
        await expect(cell.locator(':scope > .docker-port')).toHaveText(['9118', '58946', '8080']);
        const more = cell.locator('[data-docker-ports-more]');
        await expect(more).toHaveText('+2');
        await expect(page.locator('[data-docker-row="sonarr"] [data-docker-ports-more]')).toHaveCount(0);

        const pop = cell.locator('[data-docker-ports-pop]');
        await expect(pop).toBeHidden();
        await more.click();
        await expect(pop).toBeVisible();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(pop.locator('.docker-ports-pop-line')).toHaveText([
            '9118→ 9118/tcp', '58946→ 58946/tcp', '58946→ 58946/udp', '8080→ 8080/tcp', '8118→ 8118/tcp', '6881→ 6881/tcp',
        ]);
        // Opening it does not open the drawer, and nothing clips it.
        await expect(page.locator('[data-docker-drawer]')).toHaveCount(0);
        const last = pop.locator('.docker-port').last();
        const box = await last.boundingBox();
        const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        expect(hit).toBe('6881');

        await page.keyboard.press('Escape');
        await expect(pop).toBeHidden();
        await more.click();
        await page.locator('.docker-table thead').click();
        await expect(pop).toBeHidden();
    });
});
