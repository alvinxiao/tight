import { Response, Router } from 'express';

import {
    GameCreateParams,
    GameCreateResult,
    GameDeleteParams,
    GameDeleteResult,
    GameListPlayersParams,
    GameListPlayersResult,
    GameRestartParams,
    GameRestartResult,
    GameValidateParams,
    GameValidateResult,
} from 'common/api.js';

import { createGame, getGame, restartGame } from '../database/game.js';

import { deleteGameAndNotify, markGameDirty } from '../dirty.js';
import { PostRequest, GetRequest } from './types.js';

import { gameCreateSchema, gameRestartSchema, gameDeleteSchema, gameQuerySchema } from '../commandSchemas.js';
import { parseRequest } from './validation.js';

export default function initializeGameOperations(router: Router) {
    router.post('/game/create', (req: PostRequest<GameCreateParams>, res: Response<GameCreateResult>): void => {
        const parsed = parseRequest(gameCreateSchema, req.body, res);
        if (!parsed.success) return;
        const game = createGame(parsed.data);
        res.status(200).json(game.id);
    });

    router.post('/game/restart', (req: PostRequest<GameRestartParams>, res: Response<GameRestartResult | { error: string }>): void => {
        const parsed = parseRequest(gameRestartSchema, req.body, res);
        if (!parsed.success) return;
        const game = restartGame(parsed.data);
        if (game) {
            // respond with success
            res.status(200).json(game.id);

            // broadcast new game state to all clients
            markGameDirty(game.id, { created: true });
        } else {
            // respond with invalid params error
            res.status(404).json({ error: 'Game not found' });
        }
    });

    router.post('/game/delete', (req: PostRequest<GameDeleteParams>, res: Response<GameDeleteResult>): void => {
        const parsed = parseRequest(gameDeleteSchema, req.body, res);
        if (!parsed.success) return;
        const response = deleteGameAndNotify(parsed.data.id);
        res.status(200).json(response);
    });

    router.get('/game/validate', (req: GetRequest<GameValidateParams>, res: Response<GameValidateResult>): void => {
        const parsed = parseRequest(gameQuerySchema, req.query, res);
        if (!parsed.success) return;
        const game = getGame(parsed.data.gameId);
        res.status(200).json(Boolean(game));
    });

    router.get(
        '/game/list-players',
        (req: GetRequest<GameListPlayersParams>, res: Response<GameListPlayersResult>): void => {
            const parsed = parseRequest(gameQuerySchema, req.query, res);
        if (!parsed.success) return;
        const game = getGame(parsed.data.gameId);
            const players = game ? Object.keys(game.players) : [];
            res.status(200).json(players);
        },
    );
}
