import { IncomingMessage, type Server as HttpServer } from 'http';
import { type Server as HttpsServer } from 'https';
import { WebSocketServer as WSServer, WebSocket as WebSocketType } from 'ws';

import { Session } from 'common/session.js';
import { MessageType, PartialData } from 'common/message.js';
import uuidv4 from 'common/uuidv4.js';

import { getGame, getGameForClient, mutateGame } from './database/game.js';

import { WebSocket, WebSocketServer, broadcastChangeData, getWebSocketLogId, sendData } from './WebSocket.js';
import { dirty, getDirtyGameData, isDirty, setDirty } from './dirty.js';
import handleMessage from './handleMessage.js';
import parseClientMessage from './parseClientMessage.js';
import { connectionQuerySchema } from './commandSchemas.js';
import validateCommandState from './validateCommandState.js';
import log from './log.js';
import { AccessSessions, authorizeCommand, mayReadGame, visibleGame, visibleChange } from './accessSessions.js';
import { VerifyNetworkRequest } from './networkPolicy.js';

const KEEP_ALIVE_INTERVAL = 10000; // ms
const BROADCAST_INTERVAL = 300; // ms

interface OnConnectionParam {
    wss: WebSocketServer;
    ws: WebSocket;
    request: IncomingMessage;
    sessions: AccessSessions;
}

function onConnection({ wss, ws, request, sessions }: OnConnectionParam) {
    ws.on('error', () => log('Web socket connection error'));
    let query: URLSearchParams;
    try {
        query = new URL(request.url || '/', 'http://localhost').searchParams;
    } catch {
        ws.close(1008, 'Invalid connection URL');
        return;
    }
    const parameters = [...query.entries()];
    const parsed = connectionQuerySchema.safeParse(Object.fromEntries(parameters));
    if (!parsed.success || new Set(parameters.map(([key]) => key)).size !== parameters.length) {
        ws.close(1008, 'Invalid connection query');
        return;
    }
    const { gameId, playerId } = parsed.data;
    ws.accessToken = sessions.token(request);
    const session = sessions.resolve(ws.accessToken);
    if (gameId && !mayReadGame(session, gameId)) {
        ws.close(1008, 'This device cannot access that game');
        return;
    }
    ws.gameId = session.role === 'player' || session.role === 'spectator' ? session.gameId : gameId || null;
    if (playerId && session.role !== 'host' && (session.role !== 'player' || playerId !== session.playerId)) {
        ws.close(1008, 'Cannot select another player');
        return;
    }

    ws.isAlive = true;
    if (!ws.socketId) {
        ws.socketId = uuidv4();
    }

    const idMsg = getWebSocketLogId(ws);
    log(`Opening web socket connection: ${idMsg}`);

    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw, isBinary) => {
        if (isBinary) {
            ws.close(1003, 'Text commands required');
            return;
        }

        const result = parseClientMessage(raw.toString());
        if (result.kind === 'invalid') {
            ws.close(result.code, result.reason);
            return;
        }

        const game = getGame(result.message.data.gameId);
        let access;
        try {
            access = sessions.resolve(ws.accessToken || null);
        } catch (error) {
            console.error('Could not verify device access', error);
            ws.close(1011, 'Could not verify device access');
            return;
        }
        const error = game
            ? authorizeCommand(access, result.message, game) || validateCommandState(result.message, game)
            : 'Game not found';
        if (error) {
            ws.close(1008, error);
            return;
        }
        const id = result.message.data.gameId;
        const previousDirty = structuredClone(dirty.games[id]);
        const previousBinding = { gameId: ws.gameId, playerId: ws.playerId };
        try {
            mutateGame(id, () => handleMessage({ wss, ws, message: result.message }));
        } catch (error) {
            if (previousDirty) dirty.games[id] = previousDirty;
            else delete dirty.games[id];
            Object.assign(ws, previousBinding);
            console.error('Could not commit game command', error);
            ws.close(1011, 'Could not save game. Reconnect and try again.');
        }
    });
    ws.on('close', () => log(`Closing web socket connection: ${idMsg}`));

    // Maybe use as API token?
    // const data: PartialData = { socketId: ws.socketId };
    const data: PartialData = { playerId: null };

    if (ws.gameId) {
        const game = getGameForClient(ws.gameId);
        data.game = game ? visibleGame(game, session) : null;
    }

    const identity = session.role === 'player' ? session.playerId : session.role === 'host' ? playerId : null;
    if (identity && data.game?.players.includes(identity)) {
        ws.playerId = identity;
        data.playerId = identity;
    }

    // Send initial packet
    sendData({ ws, type: MessageType.BROADCAST_INITIALIZE, data });
}

export default function initialize(
    server: HttpServer | HttpsServer,
    verifyRequest: VerifyNetworkRequest,
    sessions: AccessSessions,
) {
    const wss = new WSServer({
        server,
        maxPayload: 64 * 1024,
        verifyClient: (info, done) => {
            const rejection = verifyRequest(info.req);
            if (rejection) done(false, rejection.status, rejection.message);
            else {
                try {
                    if (sessions.resolve(sessions.token(info.req)).role === 'unpaired')
                        done(false, 401, 'Pair this device with the host first');
                    else done(true);
                } catch (error) {
                    console.error('Could not verify device access', error);
                    done(false, 503, 'Could not verify device access');
                }
            }
        },
    });
    wss.on('error', () => log('WebSocket server error'));
    wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
        try {
            onConnection({ wss, ws, request, sessions });
        } catch (error) {
            console.error('Could not initialize device connection', error);
            ws.close(1011, 'Could not initialize connection');
        }
    });

    // Keep connections alive
    const heartbeat = setInterval(() => {
        if (!wss) {
            return;
        }

        wss.clients.forEach((websocket: WebSocketType) => {
            const ws: WebSocket = websocket as WebSocket;
            if (!ws.isAlive) {
                const idMsg = getWebSocketLogId(ws);
                log(`Terminating websocket for ${idMsg}`);
                return ws.terminate();
            }

            ws.isAlive = false;
            ws.ping(null, false);
        });
    }, KEEP_ALIVE_INTERVAL);

    // Broadcast changes on an interval
    const broadcasts = setInterval(() => {
        const authorized = new Map<WebSocket, Session>();
        wss.clients.forEach(socket => {
            const ws = socket as WebSocket;
            let access;
            try {
                access = sessions.resolve(ws.accessToken || null);
            } catch (error) {
                console.error('Could not verify device access', error);
                ws.gameId = null;
                ws.close(1011, 'Could not verify device access');
                return;
            }
            if (access.role === 'unpaired' || (ws.gameId && !mayReadGame(access, ws.gameId))) {
                ws.gameId = null;
                ws.close(1008, 'Device access changed. Pair again with the host.');
                return;
            }
            authorized.set(ws, access);
        });
        if (!isDirty()) {
            // Nothing changed, don't broadcast.
            return;
        }

        const dirtyGames = getDirtyGameData();
        setDirty(false);

        if (dirtyGames) {
            broadcastChangeData({
                wss,
                dirtyGames,
                serialize: (ws, change) => {
                    const access = authorized.get(ws);
                    return access ? visibleChange(change, access) : null;
                },
            });
        }
    }, BROADCAST_INTERVAL);

    let stopped: Promise<void> | undefined;
    return {
        stop: () =>
            (stopped ??= new Promise<void>(resolve => {
                clearInterval(heartbeat);
                clearInterval(broadcasts);
                wss.clients.forEach(client => client.terminate());
                wss.close(() => resolve());
            })),
    };
}
