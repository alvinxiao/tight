import { MessageType } from 'common/message.js';

export interface ClientEnvelope {
    type: MessageType;
    data: Record<string, unknown>;
}

type ParseResult =
    | { kind: 'message'; message: ClientEnvelope }
    | { kind: 'invalid'; code: 1007 | 1008; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClientMessageType(value: unknown): value is MessageType {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value > MessageType.BROADCAST_CHANGE &&
        Object.values(MessageType).includes(value)
    );
}

// This validates framing only. Individual command schemas belong at this same boundary.
export default function parseClientMessage(raw: string): ParseResult {
    let payload: unknown;
    try {
        payload = JSON.parse(raw);
    } catch {
        return { kind: 'invalid', code: 1007, reason: 'Invalid JSON' };
    }

    if (!isRecord(payload) || !isClientMessageType(payload.type) || !isRecord(payload.data)) {
        return { kind: 'invalid', code: 1008, reason: 'Invalid command envelope' };
    }

    return { kind: 'message', message: { type: payload.type, data: payload.data } };
}
