// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The table's link column opens the web UI: the address set in the drawer's
 * Custom section, else the template's -- the same address the drawer's button
 * and `:docker <name> open` go to. Other published ports stay beside it.
 */

const base = {
    shortId: 'x', image: 'img', tag: 'latest', state: 'running', status: 'Up 1 hour', health: '', created: 1790000000,
};

async function open(page) {
    await mockDocker(page, { containers: [
        { ...base, id: 'a'.repeat(64), name: 'custom', ports: [{ private: 8080, public: 8080, type: 'tcp' }, { private: 9000, public: 9000, type: 'tcp' }],
            webui: 'https://nd.home.lan/', webuiCustom: 'https://nd.home.lan/' },
        { ...base, id: 'b'.repeat(64), name: 'template', ports: [{ private: 8989, public: 18989, type: 'tcp' }],
            webui: 'http://[IP]:18989/', webuiDefault: 'http://[IP]:18989/' },
        { ...base, id: 'c'.repeat(64), name: 'plain', ports: [{ private: 80, public: 18181, type: 'tcp' }] },
        { ...base, id: 'f'.repeat(64), name: 'udponly', ports: [{ private: 53, public: 5353, type: 'udp' }] },
    ] });
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
}

const webui = (page, name) => page.locator(`[data-docker-row="${name}"] .docker-cell--webui a`);
const ports = (page, name) => page.locator(`[data-docker-row="${name}"] .docker-cell--ports a`);

test.describe('the web UI in the table', () => {
    test('the web UI has its own column, the ports keep theirs', async ({ page }) => {
        await open(page);
        await expect(webui(page, 'custom')).toHaveAttribute('href', 'https://nd.home.lan/');
        await expect(webui(page, 'custom')).toHaveText('nd.home.lan');
        await expect(webui(page, 'custom')).toHaveAttribute('title', 'https://nd.home.lan/');
        expect(await ports(page, 'custom').allInnerTexts()).toEqual(['8080', '9000']);
        // One line up: every row's web UI starts at the same x, and so do the ports.
        const x = async (loc) => Math.round((await loc.boundingBox())?.x || 0);
        expect(await x(page.locator('[data-docker-row="custom"] .docker-cell--ports')))
            .toBe(await x(page.locator('[data-docker-row="plain"] .docker-cell--ports')));
    });

    test('a template address on this host reads as its port', async ({ page }) => {
        await open(page);
        const host = await page.evaluate(() => window.location.hostname);
        await expect(webui(page, 'template')).toHaveAttribute('href', `http://${host}:18989/`);
        await expect(webui(page, 'template')).toHaveText(':18989');
        expect(await ports(page, 'template').allInnerTexts()).toEqual(['18989']);
    });

    // No template and no address of the reader's own: the first published TCP
    // port stands in, as the row menu's Web UI already did. UDP is no web page.
    test('no web UI address: the first TCP port stands in; UDP alone leaves it empty', async ({ page }) => {
        await open(page);
        const host = await page.evaluate(() => window.location.hostname);
        await expect(webui(page, 'plain')).toHaveAttribute('href', `http://${host}:18181`);
        await expect(webui(page, 'plain')).toHaveText(':18181');
        await expect(webui(page, 'plain')).toHaveAttribute('data-docker-webui-port', '');
        await expect(ports(page, 'plain').first()).toHaveAttribute('href', `http://${host}:18181`);
        await expect(webui(page, 'udponly')).toHaveCount(0);
        await expect(webui(page, 'template')).not.toHaveAttribute('data-docker-webui-port', '');
    });

    test('a long address is cut to the column, not the row', async ({ page }) => {
        await mockDocker(page, { containers: [{ ...base, id: 'd'.repeat(64), name: 'long', ports: [{ private: 1, public: 18999, type: 'tcp' }],
            webui: `https://${'very-long-subdomain.'.repeat(4)}example.lan/`, webuiCustom: 'x' }] });
        await page.goto('/#docker');
        const cell = page.locator('[data-docker-row="long"] .docker-cell--webui');
        const width = (await cell.boundingBox())?.width || 0;
        const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
        expect(width).toBeLessThanOrEqual(16 * rem);
        await expect(page.locator('[data-docker-row="long"] .docker-cell--ports a')).toBeVisible();
    });

    test('the phone line names the web UI host', async ({ page }) => {
        await open(page);
        await expect(page.locator('[data-docker-row="custom"] .docker-row-line2')).toContainText('nd.home.lan');
    });

    // Unraid's br0: the container has its own address on the LAN, and [IP]
    // in its template means that address, not the host nextDash is on.
    test('a container with its own LAN address links there', async ({ page }) => {
        await mockDocker(page, { containers: [
            { ...base, id: 'e'.repeat(64), name: 'plex', ports: [], lanIP: '192.168.1.50',
                webui: 'http://[IP]:32400/web', webuiDefault: 'http://[IP]:32400/web' },
        ] });
        await page.goto('/#docker');
        await expect(webui(page, 'plex')).toHaveAttribute('href', 'http://192.168.1.50:32400/web');
        await expect(webui(page, 'plex')).toHaveText('192.168.1.50:32400');
    });
});

test.describe('the Docker host address', () => {
    // Set where a user sets it, on Config -> Containers; the shared data dir
    // gets it back empty at the end.
    test('ports and [IP] follow the address set in Config', async ({ page }) => {
        await mockDocker(page, { containers: [
            { ...base, id: 'b'.repeat(64), name: 'template', ports: [{ private: 8989, public: 18989, type: 'tcp' }],
                webui: 'http://[IP]:18989/', webuiDefault: 'http://[IP]:18989/' },
            { ...base, id: 'e'.repeat(64), name: 'plex', ports: [], lanIP: '192.168.1.50', webui: 'http://[IP]:32400/', webuiDefault: 'x' },
        ] });
        await page.goto('/#config/containers');
        const field = page.locator('[data-behavior-field="dockerHostAddress"]');
        await field.fill('tower.lan');
        await field.press('Tab');
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerHostAddress).toBe('tower.lan');
        try {
            await page.goto('/#docker');
            await expect(webui(page, 'template')).toHaveAttribute('href', 'http://tower.lan:18989/');
            await expect(webui(page, 'template')).toHaveText(':18989');
            await expect(ports(page, 'template').first()).toHaveAttribute('href', 'http://tower.lan:18989');
            // Its own LAN address still wins over the host address.
            await expect(webui(page, 'plex')).toHaveAttribute('href', 'http://192.168.1.50:32400/');
        } finally {
            await page.goto('/#config/containers');
            await field.fill('');
            await field.press('Tab');
            await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerHostAddress ?? '').toBe('');
        }
    });
});
