import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('../src/common/message.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { MessageType: T } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
let server, origin, logs = '';
const sockets = new Set();

before(async () => {
    server = spawn(process.execPath, ['build/server.js'], {
        cwd: root, env: { ...process.env, TIGHT_USE_HTTP: 'true', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', b => logs += b);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Server readiness timeout: ${logs}`)), 10000);
        server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
        server.stdout.on('data', b => {
            logs += b;
            const match = logs.match(/Server listening on port: (\d+)/);
            if (match) { origin = `http://127.0.0.1:${match[1]}`; clearTimeout(timer); resolve(); }
        });
    });
});

after(async () => {
    for (const ws of sockets) ws.terminate();
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
});

async function request(path, body) {
    const response = await fetch(origin + '/api' + path, {
        ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    return response.json();
}

function waitMessage(ws, predicate) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error(`WebSocket message timeout: ${logs}`)); }, 3000);
        const onMessage = raw => { const value = JSON.parse(raw); if (predicate(value)) { cleanup(); resolve(value); } };
        const onClose = () => { cleanup(); reject(new Error('Socket closed before expected message')); };
        function cleanup() { clearTimeout(timer); ws.off('message', onMessage); ws.off('close', onClose); }
        ws.on('message', onMessage); ws.on('close', onClose);
    });
}

async function connect(id) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/socket' + (id ? `?gameId=${id}` : ''));
    sockets.add(ws); ws.on('error', () => {}); ws.once('close', () => sockets.delete(ws));
    const initial = await waitMessage(ws, msg => msg.type === T.BROADCAST_INITIALIZE);
    return { ws, game: initial.data.game };
}

async function snapshot(id) { const { ws, game } = await connect(id); ws.close(); return game; }
async function command(ws, type, data) {
    const changed = waitMessage(ws, msg => msg.type === T.BROADCAST_CHANGE);
    ws.send(JSON.stringify({ type, data }));
    // A harmless status command acts as a protocol fence for no-op mutations.
    ws.send(JSON.stringify({ type: T.GAME_STATUS_SET, data: { gameId: data.gameId } }));
    await changed;
}
async function gameTest(t, options = {}) {
    const id = await request('/game/create', options);
    const { ws } = await connect(id);
    t.after(async () => { ws.close(); if (server.exitCode === null) await request('/game/delete', { id }); });
    return { id, ws };
}

test('round progression respects configured limits of 1, 2, 10, and 20', async t => {
    for (const limit of [1, 2, 10, 20]) {
        const { id, ws } = await gameTest(t, { numRounds: limit });
        const changed = waitMessage(ws, msg => msg.type === T.BROADCAST_CHANGE);
        for (let i = 0; i < limit + 2; i++) ws.send(JSON.stringify({ type: T.GAME_NEXT_ROUND, data: { gameId: id } }));
        ws.send(JSON.stringify({ type: T.GAME_STATUS_SET, data: { gameId: id } }));
        await changed;
        assert.equal((await snapshot(id)).status.round, limit);
    }
});

test('repeated planet acquisition is a no-op and transfer/lose preserve ownership', async t => {
    const { id, ws } = await gameTest(t);
    for (const [order, name] of [[0, 'The Arborec'], [1, 'The Emirates of Hacan']]) {
        await command(ws, T.GAME_UPDATE_FACTION, { gameId: id, order, name });
    }
    const data = { gameId: id, factionName: 'The Arborec', planetId: 'Mecatol Rex' };
    await command(ws, T.TAKE_PLANET, { ...data, planetId: [data.planetId, data.planetId] });
    await command(ws, T.REFRESH_PLANET, data);
    await command(ws, T.TAKE_PLANET, data);
    let game = await snapshot(id);
    assert.deepEqual(game.factions[0].planets, ['Mecatol Rex']);
    assert.equal(game.planets['Mecatol Rex'].owner, data.factionName);
    assert.equal(game.planets['Mecatol Rex'].refreshed, true);
    const transfer = { ...data, factionName: 'The Emirates of Hacan' };
    await command(ws, T.TAKE_PLANET, transfer);
    game = await snapshot(id);
    assert.deepEqual(game.factions[0].planets, []);
    assert.deepEqual(game.factions[1].planets, ['Mecatol Rex']);
    assert.equal(game.planets['Mecatol Rex'].owner, transfer.factionName);
    await command(ws, T.LOST_PLANET, transfer);
    await command(ws, T.LOST_PLANET, transfer);
    game = await snapshot(id);
    assert.equal(game.planets['Mecatol Rex'].owner, null);
    assert.deepEqual(game.factions[1].planets, []);
});

test('HTTP deletion notifies both subscribers without affecting another game', async t => {
    const { id, ws } = await gameTest(t);
    const second = await connect(id);
    const other = await gameTest(t);
    const deleted = [ws, second.ws].map(socket => waitMessage(socket, msg => msg.data?.game?.deleted));
    assert.equal(await request('/game/delete', { id }), true);
    await Promise.all(deleted); second.ws.close();
    assert.equal(await request(`/game/validate?gameId=${id}`), false);
    assert.equal(await request(`/game/validate?gameId=${other.id}`), true);
    assert.equal(await request('/game/delete', { id }), false);
});

test('missing restart ends with a structured 404', async () => {
    const response = await fetch(origin + '/api/game/restart', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'NOT-A-GAME' }),
        signal: AbortSignal.timeout(1500),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Game not found' });
});

test('unknown API operations return JSON errors instead of the application HTML', async () => {
    for (const method of ['GET', 'POST']) {
        const response = await fetch(origin + '/api/not-an-operation', { method, signal: AbortSignal.timeout(1500) });
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: 'API operation not found' });
    }
});

test('malformed JSON and invalid envelopes close only the offending socket', async () => {
    for (const [payload, expected] of [
        ['{', 1007], ['null', 1008], ['[]', 1008], ['true', 1008],
        ['{"type":9999,"data":{}}', 1008], ['{"type":"9","data":{}}', 1008],
        [JSON.stringify({ type: T.GAME_NEXT_ROUND, data: null }), 1008],
        [JSON.stringify({ type: T.GAME_NEXT_ROUND, data: [] }), 1008],
    ]) {
        const { ws } = await connect(); const closed = once(ws, 'close'); ws.send(payload);
        const [code] = await closed; assert.equal(code, expected);
        assert.equal(server.exitCode, null);
        assert.ok((await request('/planet/list-names')).includes('Mecatol Rex'));
    }
});

test('binary and oversized messages are bounded without killing a healthy client', async () => {
    const healthy = await connect();
    for (const [payload, code] of [[Buffer.from('{}'), 1003], ['x'.repeat(65537), 1009]]) {
        const { ws } = await connect(); const closed = once(ws, 'close'); ws.send(payload);
        // ws reports oversized payload errors before close; connect() consumes errors.
        const [actual] = await closed; assert.equal(actual, code);
    }
    const id = await request('/game/create', {});
    try {
        healthy.ws.send(JSON.stringify({ type: T.GAME_LOAD, data: { gameId: id } }));
        const changed = await waitMessage(healthy.ws, msg => msg.data?.game?.created?.id === id);
        assert.equal(changed.data.game.created.id, id);
    } finally { healthy.ws.close(); await request('/game/delete', { id }); }
});
