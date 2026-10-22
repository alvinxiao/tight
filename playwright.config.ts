import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dataDir = mkdtempSync(path.join(tmpdir(), 'tight-browser-'));
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));

export default defineConfig({
    testDir: './tests/browser',
    outputDir: 'test-results/browser',
    timeout: 60000,
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:18743',
        headless: true,
        trace: 'retain-on-failure',
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    },
    webServer: {
        command: 'node build/server.js',
        url: 'http://127.0.0.1:18743',
        env: { TIGHT_USE_HTTP: 'true', PORT: '18743', TIGHT_DATA_DIR: dataDir },
        reuseExistingServer: false,
        timeout: 15000,
    },
});
