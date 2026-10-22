const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
    const { startBackend, defaultDataDirectory } = await import(
        pathToFileURL(path.join(__dirname, '../build/desktop-backend.js')).href
    );
    const backend = await startBackend({ port: 0, host: '127.0.0.1', dataDirectory: defaultDataDirectory() });
    process.parentPort.on('message', async event => {
        const message = event.data;
        if (
            message?.type === 'hosting' &&
            Number.isSafeInteger(message.id) &&
            message.id > 0 &&
            typeof message.change === 'boolean'
        ) {
            try {
                if (message.address !== null && (typeof message.address !== 'string' || message.address.length > 64))
                    throw new Error('Invalid network selection.');
                const value = message.change ? await backend.setLanHost(message.address) : backend.getHosting();
                process.parentPort.postMessage({ type: 'hosting', id: message.id, value });
            } catch (error) {
                const detail =
                    error?.code === 'EADDRINUSE'
                        ? 'That network port is already in use. Choose another network or restart TIGHT.'
                        : error instanceof Error
                          ? error.message
                          : 'Could not change Wi-Fi sharing.';
                process.parentPort.postMessage({ type: 'hosting', id: message.id, error: detail });
            }
        }
        if (message?.type === 'stop') {
            try {
                await backend.stop();
                process.exit(0);
            } catch (error) {
                console.error('Could not stop backend', error);
                process.exit(1);
            }
        }
    });
    process.parentPort.postMessage({
        type: 'ready',
        protocolVersion: 2,
        origin: backend.origin,
        hostToken: backend.hostToken,
    });
})().catch(error => {
    console.error('Could not start backend', error);
    process.exit(1);
});
