import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');

test('the default desktop window shows all eight setup slots and actions without scrolling', async ({}, testInfo) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tight setup layout-'));
    let app: ElectronApplication | undefined;
    try {
        const executable: unknown = process.env.TIGHT_DESKTOP_EXECUTABLE || require('electron');
        if (typeof executable !== 'string') throw new Error('Expected Electron executable path');
        app = await electron.launch({
            executablePath: executable,
            args: [
                ...(process.env.TIGHT_ELECTRON_TEST_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
                ...(process.env.TIGHT_DESKTOP_EXECUTABLE ? [] : [root]),
            ],
            cwd: directory,
            env: { ...process.env, TIGHT_DATA_DIR: directory },
        });
        const page = await app.firstWindow();
        await expect(page.getByRole('button', { name: 'Create Game', exact: true })).toBeVisible();
        const origin = new URL(page.url()).origin;
        const response = await page.request.post(`${origin}/api/game/create`, { data: { numPlayers: 8 } });
        expect(response.ok()).toBe(true);
        const id: unknown = await response.json();
        if (typeof id !== 'string') throw new Error('Expected game code');
        await page.goto(`${origin}/${id}`);
        await page.getByRole('textbox', { name: 'Enter Name', exact: true }).fill('Desktop host');
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(page.getByRole('combobox', { name: /^Faction /u })).toHaveCount(8);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('combobox', { name: 'Position for player slot 8', exact: true })).toBeInViewport();
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeInViewport();
        await expect(page.getByRole('button', { name: 'Pair a device', exact: true })).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath('desktop-eight-player-setup.png') });
    } finally {
        if (app) {
            await app.evaluate(async ({ dialog, app }) => {
                dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
                app.quit();
            });
            await app.close();
        }
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
