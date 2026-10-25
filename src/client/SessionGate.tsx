import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, sessionSchema } from 'common/session';
import { readResponse } from './utils/request';

const SessionContext = createContext<Session>({ role: 'unpaired' });
export const useSession = () => useContext(SessionContext);
type Gate = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; session: Session };

export default function SessionGate({ children }: React.PropsWithChildren) {
    const [claim] = useState(() => {
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const host = fragment.get('host');
        const pair = fragment.get('pair');
        if (host || pair) history.replaceState(null, '', window.location.pathname + window.location.search);
        return host ? { operation: 'host', token: host } : pair ? { operation: 'claim', token: pair } : null;
    });
    const [gate, setGate] = useState<Gate>({ kind: 'loading' });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const openInvitation = () => {
            const fragment = new URLSearchParams(window.location.hash.slice(1));
            // A replacement identity needs fresh session and game state throughout the app.
            if (fragment.get('host') || fragment.get('pair')) window.location.reload();
        };
        window.addEventListener('hashchange', openInvitation);
        return () => window.removeEventListener('hashchange', openInvitation);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            if (claim) {
                await readResponse(
                    `/api/session/${claim.operation}`,
                    {
                        method: 'POST',
                        signal: controller.signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: claim.token }),
                    },
                    async response => {
                        if (!response.ok) {
                            throw new Error(
                                'This host link or invitation is invalid, expired, or already used. Ask the host for a new link.',
                            );
                        }
                        await response.json();
                    },
                );
            }
            return readResponse('/api/session', { signal: controller.signal }, async response => {
                if (!response.ok)
                    throw new Error('Could not check this device. Check the host connection and try again.');
                const data: unknown = await response.json();
                return sessionSchema.parse(data);
            });
        };
        load()
            .then(session => {
                if (controller.signal.aborted) return;
                if (session.role === 'player' || session.role === 'spectator') {
                    sessionStorage.setItem('gameId', session.gameId);
                    if (session.role === 'player') sessionStorage.setItem('playerId', session.playerId);
                    else sessionStorage.removeItem('playerId');
                    if (claim || window.location.pathname === '/')
                        history.replaceState(null, '', `/${session.gameId}/status`);
                }
                setGate({ kind: 'ready', session });
            })
            .catch(error => {
                if (!controller.signal.aborted)
                    setGate({
                        kind: 'failed',
                        message: error instanceof Error ? error.message : 'Could not pair this device.',
                    });
            });
        return () => controller.abort();
    }, [claim, attempt]);
    if (gate.kind === 'loading') return <main aria-busy="true">Connecting to the host...</main>;
    if (gate.kind === 'failed')
        return (
            <main>
                <p role="alert">{gate.message}</p>
                <button onClick={() => setAttempt(value => value + 1)}>Try again</button>
            </main>
        );
    if (gate.session.role === 'unpaired')
        return (
            <main>
                <h1>Pair this device with TIGHT</h1>
                <p>Ask the host for a player or spectator invitation. The game code alone does not grant access.</p>
                <button
                    onClick={() => {
                        setGate({ kind: 'loading' });
                        setAttempt(value => value + 1);
                    }}
                >
                    Check pairing
                </button>
            </main>
        );
    return <SessionContext.Provider value={gate.session}>{children}</SessionContext.Provider>;
}
