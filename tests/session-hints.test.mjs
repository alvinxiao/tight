import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/client/utils/sessionHints.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createSessionHints } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function backing() {
    const values = new Map();
    return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

test('healthy hints observe storage changes and preserve native writes and removals', () => {
    const storage = backing();
    const hints = createSessionHints(() => storage);
    assert.equal(hints.getItem('theme'), null);
    storage.values.set('theme', 'dark');
    assert.equal(hints.getItem('theme'), 'dark');
    hints.setItem('playerId', 'Current player');
    assert.equal(storage.values.get('playerId'), 'Current player');
    hints.removeItem('playerId');
    assert.equal(storage.values.has('playerId'), false);
});

test('a denied storage getter still permits document-local hints without leaking to a new owner', () => {
    const denied = () => { throw new Error('Storage denied'); };
    const hints = createSessionHints(denied);
    assert.equal(hints.getItem('gameId'), null);
    hints.setItem('gameId', 'AAAA');
    assert.equal(hints.getItem('gameId'), 'AAAA');
    hints.removeItem('gameId');
    assert.equal(hints.getItem('gameId'), null);
    hints.setItem('theme', 'dark');
    assert.equal(createSessionHints(denied).getItem('theme'), null);
});

test('a failed write retains the intended value and previously read hints without reverting to stale backing', () => {
    const storage = backing();
    storage.values.set('gameId', 'AAAA');
    storage.values.set('theme', 'dark');
    const hints = createSessionHints(() => storage);
    assert.equal(hints.getItem('gameId'), 'AAAA');
    assert.equal(hints.getItem('theme'), 'dark');
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    hints.setItem('gameId', 'BBBB');
    assert.equal(storage.values.get('gameId'), 'AAAA');
    assert.equal(hints.getItem('gameId'), 'BBBB');
    assert.equal(hints.getItem('theme'), 'dark');
    storage.values.set('gameId', 'CCCC');
    assert.equal(hints.getItem('gameId'), 'BBBB');
});

test('a failed removal cannot resurrect a stale player hint in the current document', () => {
    const storage = backing();
    storage.values.set('playerId', 'Earlier player');
    const hints = createSessionHints(() => storage);
    assert.equal(hints.getItem('playerId'), 'Earlier player');
    storage.removeItem = () => { throw new Error('Removal denied'); };
    hints.removeItem('playerId');
    assert.equal(storage.values.get('playerId'), 'Earlier player');
    assert.equal(hints.getItem('playerId'), null);
});
