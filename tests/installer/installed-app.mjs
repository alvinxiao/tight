import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [mode, executable, directory] = process.argv.slice(2);
if (!['create', 'resume'].includes(mode) || !executable || !directory) throw new Error('Expected create/resume, installed executable, and test data directory.');
const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const environment = { ...process.env };
delete environment.TIGHT_DATA_DIR;
delete environment.NODE_PATH;
if (process.platform === 'win32') {
    for (const name of Object.keys(environment)) if (name.toLowerCase() === 'path') delete environment[name];
    environment.PATH = [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32')].join(';');
}
const app = await electron.launch({ executablePath: executable, args: [], cwd: path.dirname(executable), env: environment, timeout: 30000 });
try {
    const page = await app.firstWindow();
    const identity = await app.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron }));
    assert.deepEqual(identity, { name: 'TIGHT', version: manifest.version, packaged: true, electron: manifest.devDependencies.electron });
    const recordPath = path.join(directory, 'installer-save.json');
    if (mode === 'create') {
        await page.getByRole('button', { name: 'Create Game', exact: true }).waitFor();
        const response = await page.request.post(`${new URL(page.url()).origin}/api/game/create`, { data: { numPlayers: 2, numRounds: 3 } });
        assert.equal(response.status(), 200);
        const id = await response.json();
        assert.equal(typeof id, 'string');
        const snapshot = await (await page.request.get(`${new URL(page.url()).origin}/api/game/export?gameId=${id}`)).json();
        await writeFile(recordPath, JSON.stringify({ id, snapshot }));
    } else {
        const { id, snapshot } = JSON.parse(await readFile(recordPath, 'utf8'));
        await page.getByRole('article', { name: `Saved game ${id}`, exact: true }).waitFor();
        const restored = await (await page.request.get(`${new URL(page.url()).origin}/api/game/export?gameId=${id}`)).json();
        assert.deepEqual(restored, snapshot, 'Uninstall and reinstall must preserve the complete saved game.');
    }
} finally {
    await app.evaluate(({ dialog, app }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        app.quit();
    });
    await app.close();
}
