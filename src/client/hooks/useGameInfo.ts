import { useSession } from '../SessionGate';
import { useAppContext } from '../Context';

export default function useGameInfo() {
    const {
        state: { game, playerId, strategyCards },
    } = useAppContext();

    const session = useSession();
    const isHost = session.role === 'host';
    const canEditFaction = (name: string | null) => Boolean(name) && (isHost || (session.role === 'player' && session.gameId === game?.id &&
        game.factions.some(faction => faction.name === name && faction.playerIds.includes(session.playerId))));
    const gameId = game?.id;
    return { gameId, game, playerId, strategyCards, session, isHost, canEditFaction };
}
