const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
    const { startBackend, defaultDataDirectory } = await import(
        pathToFileURL(path.join(__dirname, '../build/desktop-backend.js')).href
    );
    const backend = await startBackend({ port: 0, host: '127.0.0.1', dataDirectory: defaultDataDirectory() });
    process.parentPort.on('message', async event => {
        if (event.data?.type === 'stop') {
            try {
                await backend.stop();
                process.exit(0);
            } catch (error) {
                console.error('Could not stop backend', error);
                process.exit(1);
            }
        }
    });
    process.parentPort.postMessage({ type: 'ready', protocolVersion: 1, origin: backend.origin });
})().catch(error => {
    console.error('Could not start backend', error);
    process.exit(1);
});
