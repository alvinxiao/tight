import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Game, GameMap } from 'common/Game.js';
import { savedGameSchema } from '../savedGameSchema.js';

export function dataDirectory(): string {
    if (process.env.TIGHT_DATA_DIR) return path.resolve(process.env.TIGHT_DATA_DIR);
    if (process.platform === 'win32')
        return path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'TIGHT');
    return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'tight');
}

export class StorageError extends Error {
    constructor(cause: unknown) {
        super('Could not save game', { cause });
    }
}

/** One host owns the database for its lifetime. SQLite releases the lock after a crash. */
export class GameStore {
    private readonly database: DatabaseSync;
    constructor(private readonly directory: string) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        this.database = new DatabaseSync(path.join(directory, 'games.sqlite'));
        try {
            this.database.exec('PRAGMA busy_timeout=1000; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
            const version = z
                .object({ user_version: z.number() })
                .parse(this.database.prepare('PRAGMA user_version').get()).user_version;
            if (version === 0) {
                const tables = this.database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
                if (tables.length) throw new Error('Unversioned game database; refusing to overwrite');
                this.database.exec(
                    'CREATE TABLE games (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL); PRAGMA user_version=1',
                );
            } else if (version !== 1) {
                throw new Error('Unsupported game database version; use a compatible version of TIGHT');
            }
            this.database.exec('COMMIT; PRAGMA synchronous=FULL');
        } catch (error) {
            this.database.close();
            throw error;
        }
    }
    close(): void {
        this.database.close();
    }
    load(): GameMap {
        const games: GameMap = {};
        for (const raw of this.database.prepare('SELECT id, snapshot FROM games').all()) {
            const row = z.object({ id: z.string(), snapshot: z.string() }).parse(raw);
            const game = savedGameSchema.parse(JSON.parse(row.snapshot));
            if (game.id !== row.id) throw new Error('Saved game ID mismatch');
            games[game.id] = game;
        }
        if (Object.keys(games).length) {
            const backups = path.join(this.directory, 'backups');
            mkdirSync(backups, { recursive: true, mode: 0o700 });
            const filename = `${Date.now()}-${randomUUID()}.sqlite`;
            this.database.prepare('VACUUM INTO ?').run(path.join(backups, filename));
            for (const old of readdirSync(backups)
                .filter(name => /^\d+-[a-f0-9-]+\.sqlite$/.test(name))
                .sort()
                .slice(0, -3)) {
                unlinkSync(path.join(backups, old));
            }
        }
        return games;
    }
    save(game: Game): Game {
        // Parse the serialized form so sparse objective arrays have the same representation on disk and reload.
        const saved = savedGameSchema.parse(JSON.parse(JSON.stringify(game)));
        const snapshot = JSON.stringify(saved);
        try {
            this.database
                .prepare(
                    'INSERT INTO games(id, snapshot) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot',
                )
                .run(game.id, snapshot);
            return saved;
        } catch (cause) {
            throw new StorageError(cause);
        }
    }
    delete(id: string): void {
        try {
            this.database.prepare('DELETE FROM games WHERE id=?').run(id);
        } catch (cause) {
            throw new StorageError(cause);
        }
    }
}
