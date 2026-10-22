import { Dispatch, useCallback, useEffect, useRef } from 'react';
import { MessageType } from 'common/message';
import { Action, ActionType, State } from '../reducer';

const RETRY_LIMIT = 5;
const RETRY_INTERVAL = 3000;
const OPEN_TIMEOUT = 10000;

export interface SendDataFunction {
    ({ type, data }: { type: MessageType; data?: unknown }): boolean;
}
export interface WebSocketOptions {
    url: string;
    dispatch: Dispatch<Action>;
    state: State;
}

export default function useWebSocket(options: WebSocketOptions) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const wsRef = useRef<WebSocket | null>(null);
    const attempts = useRef(0);
    const active = useRef(false);
    const retryTimer = useRef<ReturnType<typeof setTimeout>>();
    const openTimer = useRef<ReturnType<typeof setTimeout>>();
    const clearTimers = useCallback(() => {
        clearTimeout(retryTimer.current);
        clearTimeout(openTimer.current);
    }, []);
    const failed = useCallback(() => {
        optionsRef.current.dispatch({ type: ActionType.setConnecting, payload: { connecting: false, connectError: true } });
    }, []);

    const connect = useCallback(() => {
        if (!active.current || document.visibilityState !== 'visible') return;
        const current = wsRef.current;
        if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return;
        clearTimers();
        if (attempts.current >= RETRY_LIMIT) { failed(); return; }
        attempts.current += 1;
        const { state, dispatch, url } = optionsRef.current;
        dispatch({ type: ActionType.setConnecting, payload: { connecting: true, connectError: false } });
        const endpoint = new URL(url);
        const gameId = state.game?.id || sessionStorage.getItem('gameId');
        const playerId = state.playerId || sessionStorage.getItem('playerId');
        if (gameId) endpoint.searchParams.set('gameId', gameId);
        if (playerId) endpoint.searchParams.set('playerId', playerId);
        const ws = new WebSocket(endpoint.href);
        wsRef.current = ws;
        const isCurrent = () => active.current && wsRef.current === ws;
        openTimer.current = setTimeout(() => {
            if (isCurrent() && ws.readyState !== WebSocket.OPEN) ws.close();
        }, OPEN_TIMEOUT);
        ws.onopen = () => {
            if (!isCurrent()) return;
            clearTimers();
            attempts.current = 0;
            optionsRef.current.dispatch({ type: ActionType.setConnecting, payload: { connecting: false, connectError: false } });
        };
        ws.onmessage = event => {
            if (!isCurrent()) return;
            const { type, data } = JSON.parse(event.data);
            if (type === MessageType.BROADCAST_INITIALIZE)
                optionsRef.current.dispatch({ type: ActionType.setState, payload: data });
            else if (type === MessageType.BROADCAST_CHANGE)
                optionsRef.current.dispatch({ type: ActionType.updateState, payload: data });
        };
        ws.onclose = event => {
            if (!isCurrent()) return;
            clearTimers();
            wsRef.current = null;
            if (event.code === 1008 || event.code === 1011 || attempts.current >= RETRY_LIMIT) { failed(); return; }
            if (document.visibilityState === 'visible') retryTimer.current = setTimeout(connect, RETRY_INTERVAL);
        };
        // The close handler owns retrying failures, including rejected handshakes.
        ws.onerror = () => {};
    }, [clearTimers, failed]);

    useEffect(() => {
        active.current = true;
        connect();
        document.addEventListener('visibilitychange', connect);
        return () => {
            active.current = false;
            clearTimers();
            const ws = wsRef.current;
            wsRef.current = null;
            ws?.close();
            document.removeEventListener('visibilitychange', connect);
        };
    }, [connect, clearTimers]);

    useEffect(() => {
        if (!options.state.reconnect) return;
        attempts.current = 0;
        options.dispatch({ type: ActionType.setConnecting, payload: { reconnect: false } });
        connect();
    }, [options.state.reconnect, connect]);

    const sendData: SendDataFunction = useCallback(({ type, data }) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) { failed(); return false; }
        try {
            ws.send(JSON.stringify({ type, data }));
            return true;
        } catch {
            failed();
            return false;
        }
    }, [failed]);
    return { sendData };
}
