import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { MessageType as T } from './helpers/message-types.mjs';
process.env.TIGHT_USE_HTTP = 'true';
const { startBackend } = await import('../build/backend.js');

function packet(ws, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('No expected packet'));
        }, 3000);
        const receive = raw => {
            const data = JSON.parse(raw);
            if (predicate(data)) {
                cleanup();
                resolve(data);
            }
        };
        const closed = () => {
            cleanup();
            reject(new Error('Unexpected socket close'));
        };
        function cleanup() {
            clearTimeout(timer);
            ws.off('message', receive);
            ws.off('close', closed);
        }
        ws.on('message', receive);
        ws.on('close', closed);
    });
}
async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'tight-access-'));
    let backend = await startBackend({ host: '127.0.0.1', port: 0, dataDirectory: directory });
    const sockets = new Set();
    t.after(async () => {
        for (const socket of sockets) socket.terminate();
        await backend.stop();
        await rm(directory, { recursive: true, force: true });
    });
    function request(route, cookie = '', body) {
        return fetch(`${backend.origin}/api/${route}`, {
            headers: { cookie, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
            ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        });
    }
    const hostCookie = () => `tight-session=${backend.hostToken}`;
    const admin = (route, body) => request(route, hostCookie(), body);
    async function connect(cookie, id, name) {
        const endpoint = new URL('/socket', backend.origin.replace('http:', 'ws:'));
        if (id) endpoint.searchParams.set('gameId', id);
        if (name) endpoint.searchParams.set('playerId', name);
        const ws = new WebSocket(endpoint, { headers: { cookie } });
        ws.on('error', () => {});
        sockets.add(ws);
        const initial = await packet(ws);
        return { ws, initial: initial.data };
    }
    async function pair(gameId, role = 'player', playerId = 'Alice') {
        const invitation = await admin(
            'session/invite',
            role === 'player' ? { role, gameId, playerId } : { role, gameId },
        );
        assert.equal(invitation.status, 200);
        const { token } = await invitation.json();
        const claimed = await request('session/claim', '', { token });
        assert.equal(claimed.status, 200);
        const cookie = claimed.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('session/claim', '', { token })).status, 403, 'an invitation works once');
        const retried = await request('session/claim', cookie, { token });
        assert.equal(retried.status, 200, 'the claiming device may safely repeat a lost response');
        assert.equal(retried.headers.get('set-cookie').split(';')[0], cookie);
        return cookie;
    }
    return {
        directory,
        request,
        admin,
        hostCookie,
        connect,
        pair,
        origin: () => backend.origin,
        claimToken: () => backend.hostClaimToken,
        async restart(edit) {
            await backend.stop();
            await edit?.(directory);
            backend = await startBackend({ host: '127.0.0.1', port: 0, dataDirectory: directory });
        },
    };
}
async function command(ws, type, data, predicate = () => true) {
    const result = packet(ws, event => event.type === T.BROADCAST_CHANGE && predicate(event.data.game));
    ws.send(JSON.stringify({ type, data }));
    return (await result).data.game;
}
async function denied(ws, type, data) {
    const closed = once(ws, 'close', { signal: AbortSignal.timeout(3000) });
    ws.send(JSON.stringify({ type, data }));
    assert.equal((await closed)[0], 1008);
}
const secret = description => [-1, -2, -3].map(id => ({ cleared: false, objective: { id, description, vp: 1 } }));

test('host claims are single-use and unpaired or forged credentials cannot read or change games', async t => {
    const f = await fixture(t);
    for (const [route, body] of [
        ['game/list'],
        ['GaMe/LiSt'],
        ['GaMe/CrEaTe/', {}],
        ['game/create', {}],
        ['game/import', {}],
        ['game/delete', { id: 'ABCD' }],
        ['game/restart', { id: 'ABCD' }],
        ['game/export?gameId=ABCD'],
    ])
        assert.equal((await f.request(route, '', body)).status, 401, route);
    assert.equal((await (await f.request('session', `tight-session=${'a'.repeat(43)}`)).json()).role, 'unpaired');
    const claimed = await f.request('session/host', '', { token: f.claimToken() });
    assert.equal(claimed.status, 200);
    assert.match(claimed.headers.get('set-cookie'), /HttpOnly/);
    assert.match(claimed.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await f.request('session/host', '', { token: f.claimToken() })).status, 403);
    const ws = new WebSocket(f.origin().replace('http:', 'ws:'));
    ws.on('error', () => {});
    const response = once(ws, 'unexpected-response', { signal: AbortSignal.timeout(2000) });
    const [, rejected] = await response;
    assert.equal(rejected.statusCode, 401);
    rejected.resume();
    ws.terminate();
    const id = await (await f.admin('game/create', {})).json();
    assert.equal(
        (await f.admin('session/invite', { role: 'player', gameId: id, playerId: 'constructor' })).status,
        400,
    );
});

test('paired players can edit assigned factions, while spectators, spoofed names and other games are denied', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', { numPlayers: 2 })).json();
    const other = await (await f.admin('game/create', {})).json();
    const alice = await f.pair(id);
    const spectator = await f.pair(id, 'spectator');
    const { ws: host } = await f.connect(f.hostCookie(), id);
    await command(
        host,
        T.GAME_UPDATE_FACTION,
        { gameId: id, order: 0, name: 'The Arborec', playerIds: ['Alice'] },
        game => game.factions?.[0]?.name === 'The Arborec',
    );
    await command(
        host,
        T.GAME_UPDATE_FACTION,
        { gameId: id, order: 1, name: 'The Emirates of Hacan' },
        game => game.factions?.[1]?.name === 'The Emirates of Hacan',
    );
    for (const query of [`gameId=${other}`, `gameId=${id}&playerId=SomeoneElse`]) {
        const rejected = new WebSocket(`${f.origin().replace('http:', 'ws:')}/socket?${query}`, {
            headers: { cookie: alice },
        });
        let received = false;
        rejected.on('message', () => {
            received = true;
        });
        rejected.on('error', () => {});
        assert.equal((await once(rejected, 'close', { signal: AbortSignal.timeout(3000) }))[0], 1008);
        assert.equal(received, false, 'unauthorized subscriptions must not receive a snapshot');
    }
    const { ws: player, initial } = await f.connect(alice, id);
    assert.equal(initial.playerId, 'Alice');
    await command(
        player,
        T.SET_VICTORY_POINTS,
        { gameId: id, factionName: 'The Arborec', victoryPoints: 2 },
        game => game.factions?.[0]?.victoryPoints === 2,
    );
    for (const [route, body] of [
        ['game/delete', { id }],
        ['game/restart', { id }],
        ['game/create', {}],
        ['game/export?gameId=' + id],
        ['game/validate?gameId=' + other],
        ['session/invite', { role: 'spectator', gameId: id }],
    ])
        assert.equal((await f.request(route, alice, body)).status, 403, route);
    assert.equal((await f.request('game/validate?gameId=' + id, alice)).status, 200);
    await denied(player, T.SET_VICTORY_POINTS, { gameId: id, factionName: 'The Emirates of Hacan', victoryPoints: 99 });
    const { ws: forged } = await f.connect(alice, id);
    await denied(forged, T.GAME_ADD_PLAYER, { gameId: id, playerId: 'Another person' });
    const { ws: scoped } = await f.connect(alice, id);
    await denied(scoped, T.GAME_NEXT_ROUND, { gameId: other });
    const { ws: view } = await f.connect(spectator, id);
    await denied(view, T.SET_VICTORY_POINTS, { gameId: id, factionName: 'The Arborec', victoryPoints: 99 });
    const { ws: adminAttempt } = await f.connect(alice, id);
    await denied(adminAttempt, T.GAME_NEXT_ROUND, { gameId: id });
    const exported = await (await f.admin('game/export?gameId=' + id)).json();
    assert.equal(exported.game.factions[0].victoryPoints, 2);
    assert.equal(exported.game.factions[1].victoryPoints, 0);
    assert.equal(exported.game.status.round, 1);
    await command(
        host,
        T.SET_VICTORY_POINTS,
        { gameId: id, factionName: 'The Emirates of Hacan', victoryPoints: 3 },
        game => game.factions?.[1]?.victoryPoints === 3,
    );
});

test('private objectives are filtered in snapshots and broadcasts and revealed when the game ends', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', { numPlayers: 2 })).json();
    const alice = await f.pair(id);
    const spectator = await f.pair(id, 'spectator');
    const { ws: host } = await f.connect(f.hostCookie(), id);
    await command(host, T.GAME_UPDATE_FACTION, { gameId: id, order: 0, name: 'The Arborec', playerIds: ['Alice'] });
    await command(host, T.GAME_UPDATE_FACTION, { gameId: id, order: 1, name: 'The Emirates of Hacan' });
    await command(host, T.SET_SECRET_OBJECTIVE, {
        gameId: id,
        factionName: 'The Arborec',
        secretObjectives: secret('Alice private'),
    });
    await command(host, T.SET_SECRET_OBJECTIVE, {
        gameId: id,
        factionName: 'The Emirates of Hacan',
        secretObjectives: secret('Other private'),
    });
    const { ws: player, initial } = await f.connect(alice, id);
    assert.equal(initial.game.factions[0].secretObjectives[0].objective.description, 'Alice private');
    assert.equal(initial.game.factions[1].secretObjectives[0].objective.description, '');
    const { ws: view, initial: observed } = await f.connect(spectator, id);
    assert.equal(observed.game.factions[0].secretObjectives[0].objective.description, '');
    const changed = packet(player, event => event.data.game?.factions?.[1]?.secretObjectives);
    await command(host, T.SET_SECRET_OBJECTIVE, {
        gameId: id,
        factionName: 'The Emirates of Hacan',
        secretObjectives: secret('Changed private'),
    });
    assert.equal((await changed).data.game.factions[1].secretObjectives[0].objective.description, '');
    const ended = packet(view, event => event.data.game?.status?.ended);
    await command(host, T.END_GAME, { gameId: id, ended: true });
    assert.equal((await ended).data.game.factions[1].secretObjectives[0].objective.description, 'Changed private');
});

test('grants survive restarts, replacing a device revokes open sockets, and deletion revokes a reused code', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', {})).json();
    const alice = await f.pair(id);
    const rawToken = alice.split('=')[1];
    const bytes = await readFile(path.join(f.directory, 'games.sqlite'));
    assert.equal(bytes.includes(Buffer.from(rawToken)), false);
    assert.equal(bytes.includes(Buffer.from(createHash('sha256').update(rawToken).digest('hex'))), true);
    const exported = await (await f.admin('game/export?gameId=' + id)).json();
    assert.equal(JSON.stringify(exported).includes(rawToken), false);
    await f.restart();
    assert.equal((await (await f.request('session', alice)).json()).role, 'player');
    const { ws } = await f.connect(alice, id);
    const closed = once(ws, 'close', { signal: AbortSignal.timeout(3000) });
    const replacement = await f.pair(id);
    assert.equal((await closed)[0], 1008);
    assert.equal((await (await f.request('session', alice)).json()).role, 'unpaired');
    assert.equal((await (await f.request('session', replacement)).json()).role, 'player');
    await f.admin('game/delete', { id });
    await f.admin('game/import', exported);
    assert.equal((await (await f.request('session', replacement)).json()).role, 'unpaired');
});

test('version-one saves migrate with a separate recoverable backup and no device secrets in exports', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', {})).json();
    const saved = await (await f.admin('game/export?gameId=' + id)).json();
    // Produce the previous release's actual schema in a second directory.
    const directory = await mkdtemp(path.join(tmpdir(), 'tight-v1-'));
    const old = new DatabaseSync(path.join(directory, 'games.sqlite'));
    old.exec('CREATE TABLE games(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL); PRAGMA user_version=1');
    old.prepare('INSERT INTO games VALUES (?, ?)').run(id, JSON.stringify(saved.game));
    old.close();
    // Only one backend writer exists per process, so stop the fixture before opening the migrated directory.
    // The migration is exercised in a separate process, like a desktop upgrade.
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['build/server.js'], {
        env: { ...process.env, TIGHT_DATA_DIR: directory, TIGHT_HOST: '127.0.0.1', PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', value => {
        logs += value;
    });
    child.stderr.on('data', value => {
        logs += value;
    });
    t.after(async () => {
        if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(directory, { recursive: true, force: true });
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Migration host did not become ready')), 10000);
        child.stdout.on('data', () => {
            if (logs.includes('Server listening on port:')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`Migration host exited ${code}`));
        });
    });
    const backups = await readdir(path.join(directory, 'backups', 'migrations'));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(directory, 'backups', 'migrations', backups[0]), { readOnly: true });
    assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 1);
    assert.deepEqual(JSON.parse(backup.prepare('SELECT snapshot FROM games').get().snapshot), saved.game);
    backup.close();
});

test('expired invitations fail and failed grant writes preserve the invitation and previous device', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', {})).json();
    const alice = await f.pair(id);
    const expired = await (await f.admin('session/invite', { role: 'spectator', gameId: id })).json();
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.timers.tick(5 * 60 * 1000 + 1);
    assert.equal((await f.request('session/claim', '', { token: expired.token })).status, 403);
    t.mock.timers.reset();
    await f.restart(directory => {
        const database = new DatabaseSync(path.join(directory, 'games.sqlite'));
        database.exec(`CREATE TRIGGER fail_grant BEFORE INSERT ON access_sessions
            WHEN (SELECT json_extract(snapshot, '$.status.ended') FROM games WHERE id=NEW.game_id)=0
            BEGIN SELECT RAISE(FAIL, 'simulated grant write failure'); END`);
        database.close();
    });
    const invitation = await (
        await f.admin('session/invite', { role: 'player', gameId: id, playerId: 'Alice' })
    ).json();
    assert.equal((await f.request('session/claim', '', { token: invitation.token })).status, 503);
    assert.equal((await (await f.request('session', alice)).json()).role, 'player');
    const { ws: host } = await f.connect(f.hostCookie(), id);
    await command(host, T.END_GAME, { gameId: id, ended: true });
    const recovered = await f.request('session/claim', '', { token: invitation.token });
    assert.equal(recovered.status, 200, 'failed persistence must not consume the one-use invitation');
    assert.equal((await (await f.request('session', alice)).json()).role, 'unpaired');
});

test('invalid persisted grants fail startup without replacing the saved database', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', {})).json();
    let before;
    await assert.rejects(
        f.restart(async directory => {
            const database = new DatabaseSync(path.join(directory, 'games.sqlite'));
            database
                .prepare('INSERT INTO access_sessions(token_hash, game_id, role, player_id) VALUES (?, ?, ?, ?)')
                .run('a'.repeat(64), id, 'player', 'constructor');
            database.close();
            before = await readFile(path.join(directory, 'games.sqlite'));
        }),
    );
    assert.deepEqual(await readFile(path.join(f.directory, 'games.sqlite')), before);
});

test('only the host can revoke paired devices and unused invitations without deleting a game', async t => {
    const f = await fixture(t);
    const id = await (await f.admin('game/create', {})).json();
    const player = await f.pair(id);
    const spectator = await f.pair(id, 'spectator');
    const unused = await (await f.admin('session/invite', { gameId: id, role: 'spectator' })).json();
    const { ws: first } = await f.connect(player, id);
    const { ws: second } = await f.connect(spectator, id);
    assert.equal((await f.request('session/revoke', player, { gameId: id })).status, 403);
    const closed = [first, second].map(ws => once(ws, 'close', { signal: AbortSignal.timeout(3000) }));
    assert.equal((await f.admin('session/revoke', { gameId: id })).status, 200);
    for (const result of await Promise.all(closed)) assert.equal(result[0], 1008);
    assert.equal((await (await f.request('session', player)).json()).role, 'unpaired');
    assert.equal((await f.request('session/claim', '', { token: unused.token })).status, 403);
    assert.equal((await f.admin('game/export?gameId=' + id)).status, 200);
    assert.equal((await f.admin('session/revoke', { gameId: id })).status, 200, 'repeating revocation is harmless');
    await f.pair(id);
});
