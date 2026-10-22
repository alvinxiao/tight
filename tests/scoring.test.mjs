import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/common/Game.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { calculateVictoryPoints } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('objective scores follow stable IDs after deletion/reordering, not array positions', () => {
    const game = {
        publicObjectives: [
            { id: 3, description: '', vp: 2 },
            { id: 1, description: '', vp: 1 },
        ],
        factions: [
            {
                name: 'The Arborec',
                publicObjectives: [false, true, true],
                secretObjectives: [{ cleared: true, objective: { vp: 1 } }],
                victoryPoints: 2,
            },
        ],
    };
    // Removed objective ID 2 is still checked in the old flags but earns no points.
    assert.equal(calculateVictoryPoints(game, 'The Arborec'), 5);
});
