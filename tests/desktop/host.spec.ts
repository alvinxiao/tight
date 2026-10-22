import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');

function executable(): string {
    const value: unknown = process.env.TIGHT_DESKTOP_EXECUTABLE || require('electron');
    if (typeof value !== 'string') throw new Error('Expected Electron executable path');
    return value;
}
function launchArguments(): string[] {
    return [
        ...(process.env.TIGHT_ELECTRON_TEST_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
        ...(process.env.TIGHT_DESKTOP_EXECUTABLE ? [] : [root]),
    ];
}
async function launch(directory: string) {
    return electron.launch({
        executablePath: executable(),
        args: launchArguments(),
        cwd: directory,
        env: { ...process.env, TIGHT_DATA_DIR: directory },
    });
}
async function quit(app: ElectronApplication) {
    await app.evaluate(async ({ dialog, app }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        app.quit();
    });
    await app.close();
}

test('desktop owns a loopback backend, isolates the renderer, saves games, and stops cleanly', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tight desktop 测试-'));
    let app: ElectronApplication | undefined;
    try {
        app = await launch(directory);
        const page = await app.firstWindow();
        await expect(page.getByRole('button', { name: 'Create Game', exact: true })).toBeVisible();
        const origin = new URL(page.url());
        expect(origin.hostname).toBe('127.0.0.1');
        expect(Number(origin.port)).toBeGreaterThan(1024);
        const renderers = await app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Tab'));
        expect(renderers.length).toBeGreaterThan(0);
        if (process.platform === 'win32') expect(renderers.every(metric => metric.sandboxed)).toBe(true);
        expect(await page.evaluate(() => typeof Reflect.get(window, 'require'))).toBe('undefined');
        expect(await page.evaluate(() => document.cookie)).not.toContain('tight-session');
        const hostCookie = (await page.context().cookies()).find(cookie => cookie.name === 'tight-session');
        expect(hostCookie?.httpOnly).toBe(true);
        expect(hostCookie?.sameSite).toBe('Strict');
        const second = spawn(executable(), launchArguments(), {
            cwd: directory,
            env: { ...process.env, TIGHT_DATA_DIR: directory },
            stdio: 'ignore',
        });
        try {
            expect((await once(second, 'exit', { signal: AbortSignal.timeout(10000) }))[0]).toBe(0);
        } finally {
            if (second.exitCode === null) second.kill('SIGKILL');
        }
        await app.evaluate(({ BrowserWindow }) => {
            Reflect.set(globalThis, 'navigationPrevented', false);
            BrowserWindow.getAllWindows()[0].webContents.once('will-navigate', event =>
                Reflect.set(globalThis, 'navigationPrevented', event.defaultPrevented),
            );
        });
        await page.evaluate(() => {
            window.location.href = 'https://example.com/';
        });
        await expect.poll(() => app?.evaluate(() => Reflect.get(globalThis, 'navigationPrevented'))).toBe(true);
        expect(new URL(page.url()).origin).toBe(origin.origin);
        // Reset Playwright's pending navigation after Electron cancels it.
        await page.goto(origin.origin);
        await expect(page.getByRole('button', { name: 'Create Game', exact: true })).toBeVisible();
        const response = await page.request.post(`${origin.origin}/api/game/create`, { data: { numPlayers: 2 } });
        expect(response.ok()).toBe(true);
        const id: unknown = await response.json();
        if (typeof id !== 'string') throw new Error('Expected game code');
        await page.getByRole('button', { name: 'Refresh saved games', exact: true }).click();
        await expect(page.getByRole('article', { name: `Saved game ${id}`, exact: true })).toBeVisible();
        // Native dialogs are the only mocked boundary; the backend and windows are real.
        await app.evaluate(({ dialog }) => {
            dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
        });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await expect(page.getByRole('button', { name: 'Create Game', exact: true })).toBeVisible();
        await quit(app);
        app = undefined;
        await expect(async () => {
            await expect(fetch(origin.origin, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
        }).toPass();
        app = await launch(directory);
        const resumed = await app.firstWindow();
        await expect(resumed.getByRole('article', { name: `Saved game ${id}`, exact: true })).toBeVisible();
        await app.evaluate(({ dialog }) => {
            dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
        });
        const backendPid = await app.evaluate(
            ({ app }) => app.getAppMetrics().find(metric => metric.name === 'TIGHT game server')?.pid,
        );
        if (!backendPid) throw new Error('Missing backend utility process');
        const recoveredWindow = app.waitForEvent('window');
        process.kill(backendPid, 'SIGKILL');
        const recovered = await recoveredWindow;
        await expect(recovered.getByRole('article', { name: `Saved game ${id}`, exact: true })).toBeVisible();
        const nextPid = await app.evaluate(
            ({ app }) => app.getAppMetrics().find(metric => metric.name === 'TIGHT game server')?.pid,
        );
        expect(nextPid).not.toBe(backendPid);
        await recovered.getByRole('link', { name: `Resume ${id}`, exact: true }).click();
        await expect(recovered.getByRole('textbox', { name: 'Enter Name', exact: true })).toBeVisible();
    } finally {
        if (app) await quit(app);
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
