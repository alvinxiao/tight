import { expect, test, Page } from '@playwright/test';

async function register(page: Page, name: string) {
    await page.getByRole('textbox', { name: 'Enter Name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

test('host creates and starts a game; an independent phone browser joins', async ({
    page,
    browser,
    request,
    baseURL,
}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let id: string | undefined;
    const guest = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
        await page.goto('/');
        await page.getByRole('button', { name: 'Create Game', exact: true }).click();
        await page.getByRole('combobox').first().click();
        await page.getByRole('option', { name: '2', exact: true }).click();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Enter Name', exact: true })).toBeVisible();
        id = new URL(page.url()).pathname.split('/')[1];
        await register(page, 'Host');
        await expect(page.getByRole('combobox').nth(1)).toBeVisible();
        for (const [index, name, color] of [
            [0, 'The Arborec', 'RED'],
            [1, 'The Emirates of Hacan', 'BLUE'],
        ] as const) {
            // Accessible names for these legacy controls are tracked in issue #17.
            await page
                .getByRole('combobox')
                .nth(index * 4 + 1)
                .click();
            await page.getByRole('option', { name, exact: true }).click();
            await page
                .getByRole('combobox')
                .nth(index * 4 + 2)
                .click();
            await page.getByRole('option', { name: color, exact: true }).click();
        }
        await page.getByRole('combobox').nth(3).click();
        await page.getByRole('option', { name: 'Host', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await expect(page.getByText('Turn: The Arborec', { exact: true })).toBeVisible();

        const phone = await guest.newPage();
        phone.on('pageerror', error => errors.push(error.message));
        await phone.goto('/');
        await phone.getByRole('button', { name: 'Join Game', exact: true }).click();
        await phone.getByRole('textbox', { name: 'Game Code', exact: true }).fill(id);
        await phone.getByRole('button', { name: 'Join', exact: true }).click();
        await register(phone, 'Phone guest');
        await expect(phone.getByText('Turn: The Arborec', { exact: true })).toBeVisible();
        await expect(phone.getByText('Round: 1', { exact: true })).toBeVisible();
        expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(errors).toEqual([]);
    } finally {
        await guest.close();
        if (id) await request.post('/api/game/delete', { data: { id } });
    }
});

test('invalid input and request failures remain recoverable on a nondefault port', async ({ page, request }) => {
    const errors: string[] = [];
    const sockets: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => sockets.push(socket.url()));
    let id: string | undefined;
    await page.addInitScript(() => {
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
                super(url, protocols);
                Reflect.set(window, 'testGameSocket', this);
            }
        };
    });
    try {
        await page.goto('/');
        await page.getByRole('button', { name: 'Join Game', exact: true }).click();
        await page.getByRole('textbox', { name: 'Game Code', exact: true }).fill('1234');
        await page.getByRole('button', { name: 'Join', exact: true }).click();
        await expect(page.getByText('Invalid Game Code', { exact: true })).toBeVisible();
        await page.getByRole('textbox', { name: 'Game Code', exact: true }).fill('AAAA');
        await page.route('**/api/game/validate?*', route =>
            route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' }),
        );
        await page.getByRole('button', { name: 'Join', exact: true }).click();
        await expect(page.getByText('Could not reach the host. Try again.', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
        await page.unroute('**/api/game/validate?*');
        await page.getByRole('button', { name: 'Close', exact: true }).click();

        await page.getByRole('button', { name: 'Create Game', exact: true }).click();
        await page.route('**/api/game/create', route =>
            route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Invalid request"}' }),
        );
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Could not create the game');
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
        await page.unroute('**/api/game/create');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Enter Name', exact: true })).toBeVisible();
        id = new URL(page.url()).pathname.split('/')[1];
        await page.getByRole('textbox', { name: 'Enter Name', exact: true }).fill('constructor');
        await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
        await expect(page.getByText('Choose a different name, up to 80 characters.', { exact: true })).toBeVisible();
        await register(page, 'Host & Unicode 测试');
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
        expect(sockets.some(url => new URL(url).searchParams.get('playerId') === 'Host & Unicode 测试')).toBe(true);
        expect(sockets.every(url => new URL(url).port === '18743')).toBe(true);

        await page.getByRole('button', { name: 'Game Info', exact: true }).click();
        await page.getByRole('button', { name: 'Restart Game...', exact: true }).click();
        await page.route('**/api/game/restart', route =>
            route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Game not found"}' }),
        );
        await page.getByRole('button', { name: 'Restart Game', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Could not restart');
        await expect(page.getByRole('button', { name: 'Restart Game', exact: true })).toBeEnabled();
        await page.unroute('**/api/game/restart');
        await page.getByRole('button', { name: 'Restart Game', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();

        await page.evaluate(() => {
            const socket = Reflect.get(window, 'testGameSocket');
            if (!(socket instanceof WebSocket)) throw new Error('Missing game socket');
            socket.send(JSON.stringify({ type: 9999, data: {} }));
        });
        await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
        await expect(page.getByText('Host & Unicode 测试', { exact: true })).toBeVisible();
        for (const path of ['/no-such-route', '/not/a/path']) {
            await page.goto(path);
            await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Go to Home page', exact: true })).toBeVisible();
        }
        await page.goto('/AAAA');
        await expect(
            page.getByText('Game AAAA was not found or is no longer available', { exact: true }),
        ).toBeVisible();
        expect(errors).toEqual([]);
    } finally {
        if (id) await request.post('/api/game/delete', { data: { id } });
    }
});

test('saved games can resume, export, delete with confirmation, and import with recovery', async ({
    page,
    request,
}) => {
    const created = await request.post('/api/game/create', { data: { numPlayers: 2 } });
    const id: unknown = await created.json();
    if (typeof id !== 'string') throw new Error('Expected a created game code');
    const card = page.getByRole('article', { name: `Saved game ${id}`, exact: true });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto('/');
        await expect(card).toContainText('Setting up');
        await expect(card).toContainText('Round 1 of 10');
        await page.route('**/api/game/validate?*', route =>
            route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
        );
        await page.getByRole('link', { name: `Resume ${id}`, exact: true }).click();
        await expect(page.getByRole('button', { name: 'Retry loading game', exact: true })).toBeVisible();
        await page.unroute('**/api/game/validate?*');
        await page.getByRole('button', { name: 'Retry loading game', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Enter Name', exact: true })).toBeVisible();
        await page.goto('/');
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: `Export ${id}`, exact: true }).click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe(`tight-${id}.json`);
        const filename = await download.path();
        if (!filename) throw new Error('Missing game export');
        const { readFile } = await import('node:fs/promises');
        const buffer = await readFile(filename);
        const upload = () =>
            page
                .getByLabel('Import game file')
                .setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer });
        await upload();
        await expect(page.getByRole('alert')).toContainText('already exists');
        await expect(card).toBeVisible();
        await page.getByRole('button', { name: `Delete ${id}`, exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(card).toBeVisible();
        await page.route('**/api/game/delete', route =>
            route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
        );
        await page.getByRole('button', { name: `Delete ${id}`, exact: true }).click();
        await page.getByRole('button', { name: 'Delete saved game', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('could not save');
        await expect(card).toBeVisible();
        await page.unroute('**/api/game/delete');
        await page.getByRole('button', { name: `Delete ${id}`, exact: true }).click();
        await page.getByRole('button', { name: 'Delete saved game', exact: true }).click();
        await expect(card).toHaveCount(0);
        await upload();
        await expect(page.getByRole('alert')).toContainText(`Imported game ${id}`);
        await expect(card).toBeVisible();
        await page
            .getByLabel('Import game file')
            .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
        await expect(page.getByRole('alert')).toContainText('not a supported TIGHT');
        await page
            .getByLabel('Import game file')
            .setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(1024 * 1024 + 1) });
        await expect(page.getByRole('alert')).toContainText('too large');
        await expect(card).toBeVisible();
        await page.route('**/api/game/list', route =>
            route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
        );
        await page.getByRole('button', { name: 'Refresh saved games', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'Could not load saved games' })).toBeVisible();
        await page.unroute('**/api/game/list');
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(card).toBeVisible();
        await page.evaluate(() => {
            sessionStorage.setItem('gameId', 'AAAA');
            sessionStorage.setItem('playerId', '');
        });
        await page.reload();
        await expect(card).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
    } finally {
        await request.post('/api/game/delete', { data: { id } });
    }
});
