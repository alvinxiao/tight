import { IncomingMessage, type Server as HttpServer } from 'http';
import { type Server as HttpsServer } from 'https';
import { WebSocketServer as WSServer, WebSocket as WebSocketType } from 'ws';

import { MessageType, PartialData } from 'common/message.js';
import uuidv4 from 'common/uuidv4.js';

import { getGame, getGameForClient } from './database/game.js';

import { WebSocket, WebSocketServer, broadcastChangeData, getWebSocketLogId, sendData } from './WebSocket.js';
import { getDirtyGameData, isDirty, removeOldGames, setDirty } from './dirty.js';
import handleMessage from './handleMessage.js';
import parseClientMessage from './parseClientMessage.js';
import { connectionQuerySchema } from './commandSchemas.js';
import validateCommandState from './validateCommandState.js';
import log from './log.js';

const KEEP_ALIVE_INTERVAL = 10000; // ms
const BROADCAST_INTERVAL = 300; // ms
const REMOVE_GAME_INTERVAL = 1000 * 60 * 60; // 1 hour

interface OnConnectionParam {
    wss: WebSocketServer;
    ws: WebSocket;
    request: IncomingMessage;
}

let wss: WebSocketServer;

function onConnection({ wss, ws, request }: OnConnectionParam) {
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
    ws.gameId = gameId || null;

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
        const error = game ? validateCommandState(result.message, game) : 'Game not found';
        if (error) {
            ws.close(1008, error);
            return;
        }
        handleMessage({ wss, ws, message: result.message });
    });
    ws.on('close', () => log(`Closing web socket connection: ${idMsg}`));

    // Maybe use as API token?
    // const data: PartialData = { socketId: ws.socketId };
    const data: PartialData = { playerId: null };

    if (ws.gameId) {
        data.game = getGameForClient(ws.gameId);
    }

    if (playerId && data.game?.players.includes(playerId)) {
        ws.playerId = playerId;
        data.playerId = playerId;
    }

    // Send initial packet
    sendData({ ws, type: MessageType.BROADCAST_INITIALIZE, data });
}

export default function initialize(server: HttpServer | HttpsServer) {
    if (wss) {
        return wss;
    }

    wss = new WSServer({ server, maxPayload: 64 * 1024 });
    wss.on('connection', (ws: WebSocket, request: IncomingMessage) => onConnection({ wss, ws, request }));

    // Keep connections alive
    setInterval(() => {
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

    // Interval to remove games that haven't had activity in a while.
    setInterval(removeOldGames, REMOVE_GAME_INTERVAL);

    // Broadcast changes on an interval
    setInterval(() => {
        if (!isDirty()) {
            // Nothing changed, don't broadcast.
            return;
        }

        const dirtyGames = getDirtyGameData();
        setDirty(false);

        if (dirtyGames) {
            broadcastChangeData({ wss, dirtyGames });
        }
    }, BROADCAST_INTERVAL);

    return wss;
}
