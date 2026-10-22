const { app, BrowserWindow, dialog, session, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.setName('TIGHT');
app.setAppUserModelId('org.alvinxiao.tight');
if (process.env.TIGHT_DATA_DIR) {
    const profile = path.join(path.resolve(process.env.TIGHT_DATA_DIR), 'desktop-profile');
    fs.mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
}

let window;
let child;
let quitting = false;
let recovering = false;
let quitPrompt = false;
let activeOrigin;
const expectedExits = new WeakSet();

function isReady(message) {
    if (!message || message.type !== 'ready' || message.protocolVersion !== 2 || typeof message.origin !== 'string')
        return false;
    try {
        const url = new URL(message.origin);
        return (
            typeof message.hostToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.hostToken) &&
            url.protocol === 'http:' &&
            url.hostname === '127.0.0.1' &&
            Number(url.port) > 1024 &&
            url.username === '' &&
            url.password === '' &&
            url.pathname === '/' &&
            url.search === '' &&
            url.hash === ''
        );
    } catch {
        return false;
    }
}

async function stopBackend() {
    const current = child;
    if (!current) return;
    expectedExits.add(current);
    await new Promise(resolve => {
        const timeout = setTimeout(() => {
            current.kill();
        }, 5000);
        current.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
        try {
            current.postMessage({ type: 'stop' });
        } catch {
            current.kill();
        }
    });
    if (child === current) child = undefined;
}

function startBackend() {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, TIGHT_USE_HTTP: 'true' };
        delete env.NODE_OPTIONS;
        delete env.ELECTRON_RUN_AS_NODE;
        const current = utilityProcess.fork(path.join(__dirname, 'backend.cjs'), [], {
            env,
            stdio: 'pipe',
            serviceName: 'TIGHT game server',
        });
        child = current;
        // Drain output without retaining game snapshots or credentials in native diagnostics.
        current.stdout?.on('data', () => {});
        current.stderr?.on('data', () => {});
        let ready = false;
        const timeout = setTimeout(() => {
            current.kill();
            reject(new Error('The game server did not start in time.'));
        }, 20000);
        current.on('message', message => {
            if (ready) return;
            if (!isReady(message)) {
                current.kill();
                reject(new Error('The game server returned invalid startup information.'));
                return;
            }
            ready = true;
            clearTimeout(timeout);
            resolve({ origin: message.origin, hostToken: message.hostToken });
        });
        current.once('exit', () => {
            clearTimeout(timeout);
            if (child === current) child = undefined;
            if (!ready)
                reject(
                    new Error(
                        'The game server could not open its saved games. Check that another host is not using this data folder and that storage is available.',
                    ),
                );
            else if (!quitting && !expectedExits.has(current))
                void recover('The game server stopped. Your committed games are saved. Restart the server to resume.');
        });
    });
}

async function recover(message) {
    if (quitting || recovering) return;
    recovering = true;
    if (window && !window.isDestroyed()) window.hide();
    const result = await dialog.showMessageBox({
        type: 'error',
        title: 'TIGHT could not host games',
        message,
        buttons: ['Restart server', 'Quit'],
        defaultId: 0,
        cancelId: 1,
    });
    recovering = false;
    if (result.response === 0) void launch();
    else {
        quitting = true;
        await stopBackend();
        app.quit();
    }
}

function configureWindow(origin) {
    if (window && !window.isDestroyed()) window.destroy();
    activeOrigin = origin;
    window = new BrowserWindow({
        width: 1200,
        height: 850,
        minWidth: 390,
        minHeight: 500,
        title: 'TIGHT (local only)',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            devTools: !app.isPackaged,
        },
    });
    window.removeMenu();
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guardNavigation = event => {
        try {
            if (new URL(event.url).origin === origin) return;
        } catch {}
        event.preventDefault();
    };
    window.webContents.on('will-navigate', guardNavigation);
    window.webContents.on('will-redirect', guardNavigation);
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.on('close', event => {
        if (!quitting) {
            event.preventDefault();
            void requestQuit();
        }
    });
    window.once('ready-to-show', () => window?.show());
    window.webContents.on('render-process-gone', () => {
        if (!quitting) void recover('The app window stopped. Restart the server to reopen your saved games.');
    });
    return window.loadURL(origin);
}

async function launch() {
    try {
        await stopBackend();
        const { origin, hostToken } = await startBackend();
        await session.defaultSession.cookies.set({ url: origin, name: 'tight-session', value: hostToken, httpOnly: true, sameSite: 'strict', secure: false });
        await configureWindow(origin);
    } catch (error) {
        void recover(error instanceof Error ? error.message : 'Could not start TIGHT.');
    }
}

async function requestQuit() {
    if (quitPrompt || quitting) return;
    quitPrompt = true;
    const options = {
        type: 'question',
        title: 'Close TIGHT?',
        message: 'Close TIGHT and stop hosting?',
        detail: 'Committed games are saved. Players will lose their connection until you reopen TIGHT.',
        buttons: ['Keep TIGHT open', 'Quit and save'],
        defaultId: 0,
        cancelId: 0,
    };
    const result = await (window && !window.isDestroyed()
        ? dialog.showMessageBox(window, options)
        : dialog.showMessageBox(options));
    quitPrompt = false;
    if (result.response === 1) {
        quitting = true;
        await stopBackend();
        app.quit();
    }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => {
        if (window) {
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
        }
    });
    app.on('before-quit', event => {
        if (!quitting) {
            event.preventDefault();
            void requestQuit();
        }
    });
    app.whenReady().then(() => {
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        session.defaultSession.setPermissionCheckHandler(() => false);
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            if (activeOrigin && new URL(details.url).origin === activeOrigin) {
                headers['Content-Security-Policy'] = [
                    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${activeOrigin.replace('http:', 'ws:')}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self'`,
                ];
            }
            callback({ responseHeaders: headers });
        });
        void launch();
    });
    app.on('window-all-closed', () => {
        if (quitting) app.quit();
    });
}
