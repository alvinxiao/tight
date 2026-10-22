import { z } from 'zod';

import { Phase, StrategyCardIndex, Version } from 'common/Game.js';
import { Traits } from 'common/Planet.js';
import { GAME_CODE_PATTERN } from 'common/gameCode.js';
import { isPlayerName } from 'common/playerName.js';
import { MessageType } from 'common/message.js';
import { FactionColor } from 'common/colors.js';
import { listFactionNames } from './database/faction/index.js';
import { listPlanetNames } from './database/planet/index.js';

const factionNames = new Set(listFactionNames());
const planetNames = new Set(listPlanetNames());
export const gameIdSchema = z.string().regex(GAME_CODE_PATTERN);
const playerId = z.string().refine(isPlayerName, 'Invalid player name');
const factionName = z.string().refine(value => factionNames.has(value), 'Unknown faction');
const color = z
    .string()
    .refine(
        value => value === 'None' || Object.values(FactionColor).some(candidate => candidate === value),
        'Unknown color',
    );
const planetId = z.string().refine(value => planetNames.has(value), 'Unknown planet');
const planetIds = z.union([planetId, z.array(planetId).max(planetNames.size)]);
const playerIds = z
    .array(playerId)
    .max(32)
    .refine(values => new Set(values).size === values.length);
const index = z.number().int().min(0).max(7);
const objective = z
    .object({
        id: z.number().int(),
        description: z.string().max(1024),
        vp: z.number().int().min(1).max(10),
    })
    .strict();
const publicObjective = objective.extend({ id: z.number().int().min(1).max(100) });
const publicObjectives = z
    .array(publicObjective)
    .max(50)
    .refine(values => new Set(values.map(value => value.id)).size === values.length, 'Duplicate objective IDs');
const secretObjectives = z
    .array(
        z
            .object({
                cleared: z.boolean(),
                objective: objective.extend({ id: z.number().int().min(-3).max(-1) }),
            })
            .strict(),
    )
    .length(3)
    .refine(
        values => values.every((value, position) => value.objective.id === -position - 1),
        'Invalid secret objective order',
    );
const modifier = z.number().finite().int().min(-100).max(100).optional();
const modifiers = z
    .object({
        resources: modifier,
        influence: modifier,
        biotic: modifier,
        warfare: modifier,
        propulsion: modifier,
        cybernetic: modifier,
        trait: z.array(z.nativeEnum(Traits)).max(3).optional(),
        DMZ: z.boolean().optional(),
    })
    .strict();
const base = z.object({ gameId: gameIdSchema }).strict();
const faction = base.extend({ factionName });
const planet = faction.extend({ planetId: planetIds });
const status = base.extend({
    phase: z.nativeEnum(Phase).optional(),
    turn: z.nativeEnum(StrategyCardIndex).optional(),
    pickOrder: z.array(factionName).min(1).max(8).optional(),
    pickTurn: index.optional(),
    speaker: factionName.optional(),
});

export const gameCreateSchema = z
    .object({
        version: z.nativeEnum(Version).optional(),
        numPlayers: z.number().int().min(1).max(8).optional(),
        numRounds: z.number().int().min(1).max(20).optional(),
        numVictoryPoints: z.number().int().min(1).max(20).optional(),
        publicObjectives: publicObjectives.optional(),
    })
    .strict();
export const gameRestartSchema = gameCreateSchema.extend({ id: gameIdSchema });
export const gameDeleteSchema = z.object({ id: gameIdSchema }).strict();
export const gameQuerySchema = base;
export const connectionQuerySchema = z
    .object({
        gameId: gameIdSchema.optional(),
        playerId: playerId.optional(),
    })
    .strict();
export const factionQuerySchema = z
    .object({
        name: z
            .string()
            .min(1)
            .max(4096)
            .refine(value => {
                const names = value.split(',');
                return names.length <= 32 && names.every(name => factionNames.has(name));
            }, 'Unknown faction'),
    })
    .strict();
const selectablePlanetFields = new Set([
    'name',
    'trait',
    'resources',
    'influence',
    'home',
    'legendary',
    'DMZ',
    'biotic',
    'warfare',
    'propulsion',
    'cybernetic',
]);
export const planetQuerySchema = z
    .object({
        select: z
            .string()
            .max(256)
            .refine(
                value => !value || value === '*' || value.split(',').every(field => selectablePlanetFields.has(field)),
                'Unknown planet field',
            )
            .optional(),
    })
    .strict();

function command<Type extends MessageType, Data extends z.AnyZodObject>(type: Type, data: Data) {
    return z.object({ type: z.literal(type), data }).strict();
}

export const clientCommandSchema = z.discriminatedUnion('type', [
    command(
        MessageType.GAME_LOAD,
        base.extend({ playerId: playerId.nullable().optional(), factionName: factionName.optional() }),
    ),
    command(MessageType.GAME_ADD_PLAYER, base.extend({ playerId })),
    command(
        MessageType.GAME_UPDATE_FACTION,
        base.extend({
            order: index,
            name: z.union([z.literal('None'), factionName]).optional(),
            color: color.optional(),
            playerIds: playerIds.optional(),
        }),
    ),
    command(MessageType.GAME_REORDER_FACTION, base.extend({ index, newIndex: index })),
    command(MessageType.START_GAME, base),
    command(MessageType.STOP_GAME, base),
    command(MessageType.END_GAME, base.extend({ ended: z.boolean().optional() })),
    command(MessageType.GAME_SET_PUBLIC_OBJECTIVES, base.extend({ publicObjectives })),
    command(MessageType.GAME_STATUS_SET, status),
    command(MessageType.GAME_SET_SPEAKER, base.extend({ speaker: factionName })),
    command(
        MessageType.GAME_SET_CUSTODIANS_REMOVED,
        base.extend({
            custodiansRemoved: z.boolean(),
            agenda1Voted: z.boolean().optional(),
            agenda2Voted: z.boolean().optional(),
        }),
    ),
    command(
        MessageType.GAME_SET_AGENDA_VOTED,
        base.extend({ agenda1Voted: z.boolean().optional(), agenda2Voted: z.boolean().optional() }),
    ),
    command(MessageType.GAME_NEXT_ROUND, base),
    command(MessageType.UPDATE_PLANET, base.extend({ planetId, modifiers })),
    command(MessageType.TAKE_NAALU_ZERO_TOKEN, faction),
    command(MessageType.TAKE_STRATEGY_CARD, faction.extend({ strategyCard: z.nativeEnum(StrategyCardIndex) })),
    command(
        MessageType.RETURN_STRATEGY_CARD,
        faction.extend({ strategyCard: z.nativeEnum(StrategyCardIndex).optional() }),
    ),
    command(MessageType.FLIP_STRATEGY_CARD, faction.extend({ flipped: z.boolean() })),
    command(MessageType.PASS_TURN, faction.extend({ passed: z.boolean() })),
    // JSON serializes sparse checkbox arrays as nulls; normalize those holes to false.
    command(
        MessageType.SET_PUBLIC_OBJECTIVES,
        faction.extend({
            publicObjectives: z
                .array(z.boolean().nullable())
                .max(100)
                .transform(values => values.map(value => value ?? false)),
        }),
    ),
    command(MessageType.SET_SECRET_OBJECTIVE, faction.extend({ secretObjectives })),
    command(
        MessageType.SET_VICTORY_POINTS,
        faction.extend({ victoryPoints: z.number().finite().int().min(-100).max(100) }),
    ),
    command(MessageType.TAKE_PLANET, planet),
    command(MessageType.LOST_PLANET, planet),
    command(MessageType.EXHAUST_PLANET, planet.extend({ ability: z.boolean().optional() })),
    command(MessageType.REFRESH_PLANET, planet.extend({ ability: z.boolean().optional() })),
    command(MessageType.EXHAUST_PLANET_ABILITY, planet),
    command(MessageType.REFRESH_PLANET_ABILITY, planet),
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;
