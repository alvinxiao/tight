import express, { NextFunction, Request, Response } from 'express';
import http, { type Server as HttpServer } from 'http';
import https, { type Server as HttpsServer } from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

import { dataDirectory as defaultDataDirectory, StorageError } from './database/GameStore.js';
import initializeWebSocketServer from './WebSocketServer.js';
import { cert, key } from './certs.js';
import initializeRouter from './rest-api/router.js';
import { createNetworkPolicy, trustedHostnames, VerifyNetworkRequest } from './networkPolicy.js';
import { setDirty } from './dirty.js';
import { initializeGameStorage, closeGameStorage } from './database/game.js';
export { defaultDataDirectory };

export interface BackendOptions {
    port: number;
    host?: string;
    dataDirectory: string;
}

export async function startBackend(options: BackendOptions) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
        throw new Error('Invalid server port');
    const hostnames = trustedHostnames(options.host);
    initializeGameStorage(options.dataDirectory);
    setDirty(false);
    try {
        const dirname = path.dirname(fileURLToPath(import.meta.url));

        let verifyRequest: VerifyNetworkRequest = () => ({ status: 503, message: 'Host is starting' });
        const app = express();
        app.use((req: Request, res: Response, next: NextFunction) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            res.setHeader('Referrer-Policy', 'no-referrer');
            const rejection = verifyRequest(req);
            if (rejection) res.status(rejection.status).json({ error: rejection.message });
            else next();
        });
        let port = options.port;
        const distDir = path.join(dirname, '../dist');
        const html = path.join(distDir, 'index.html');

        const publicPath = express.static(distDir);
        app.use(publicPath);
        app.use('/api/game/import', express.json({ limit: '1mb' }));
        app.use(express.json({ limit: '64kb' }));
        app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }));

        app.use('/api', initializeRouter());
        app.use('/api', (_req: Request, res: Response) => {
            res.status(404).json({ error: 'API operation not found' });
        });

        app.get('*', (req: Request, res: Response) => {
            res.sendFile(html);
        });

        app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
            if (res.headersSent) {
                next(error);
                return;
            }
            const parserType = typeof error === 'object' && error !== null && 'type' in error ? error.type : null;
            if (error instanceof StorageError) {
                console.error('Game storage failed', error.cause);
                res.status(503).json({ error: 'Could not save game. Try again after checking host storage.' });
            } else if (parserType === 'entity.too.large') {
                res.status(413).json({ error: 'Request too large' });
            } else if (parserType === 'entity.parse.failed') {
                res.status(400).json({ error: 'Invalid JSON body' });
            } else {
                console.error('Unhandled request error', error instanceof Error ? error.stack : 'Unknown error');
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        let protocol: 'http' | 'https' = 'http';
        let server: HttpServer | HttpsServer;
        if (key && cert) {
            server = https.createServer({ key, cert }, app);
            protocol = 'https';
            if (port === 80) {
                port = 443;
            }
        } else {
            server = http.createServer(app);
        }

        const sockets = initializeWebSocketServer(server, request => verifyRequest(request));
        let stopPromise: Promise<void> | undefined;
        const stop = () =>
            (stopPromise ??= (async () => {
                await sockets.stop();
                await new Promise<void>((resolve, reject) => {
                    server.close(error => (error ? reject(error) : resolve()));
                    server.closeAllConnections();
                });
                setDirty(false);
                closeGameStorage();
            })());
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, options.host, () => {
                    server.off('error', reject);
                    resolve();
                });
            });
        } catch (error) {
            await sockets.stop();
            throw error;
        }
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
        verifyRequest = createNetworkPolicy({ hostnames, protocol, port: address.port });
        const originHost =
            options.host && options.host !== '0.0.0.0' && options.host !== '::' ? options.host : '127.0.0.1';
        const authority = originHost.includes(':') ? `[${originHost}]` : originHost;
        return { origin: `${protocol}://${authority}:${address.port}`, port: address.port, stop };
    } catch (error) {
        closeGameStorage();
        throw error;
    }
}
