import chalk from 'chalk';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import http, { type Server as HttpServer } from 'http';
import https, { type Server as HttpsServer } from 'https';
import ip from 'ip';
import path from 'path';
import { fileURLToPath } from 'url';

import { StorageError } from './database/GameStore.js';
import initializeWebSocketServer from './WebSocketServer.js';
import { cert, key } from './certs.js';
import initializeRouter from './rest-api/router.js';

// workaround for import.meta.dirname being undefined in node 20
const dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const app = express();
let port = process.env.PORT === undefined ? 80 : Number(process.env.PORT);
const distDir = path.join(dirname, '../dist');
const html = path.join(distDir, 'index.html');

const publicPath = express.static(distDir);
app.use(publicPath);
app.use(cors());
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

let protocol = 'http';
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

initializeWebSocketServer(server);

server.listen(port, () => {
    const address = server.address();
    const boundPort = address && typeof address !== 'string' ? address.port : port;
    const ipAddress = chalk.cyanBright(`${protocol}://${ip.address()}:${boundPort}/`);
    console.log(`Server listening on port: ${boundPort}`);
    console.log(`Server running on: ${ipAddress}`);
});
