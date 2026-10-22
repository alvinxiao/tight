# Game storage and recovery

The backend stores games in `games.sqlite` using Node's built-in SQLite support. Use Node 24.19.0 (recommended) or at least 22.13.0. The database format is version 1.

The default directory is `%LOCALAPPDATA%\TIGHT` on Windows, or `$XDG_DATA_HOME/tight` on other systems (falling back to `~/.local/share/tight`). `TIGHT_DATA_DIR` overrides the directory. Data stays outside the application installation and survives a server restart. The future Electron launcher must pass its per-user data directory explicitly.

For this cloud workspace, set `TIGHT_DATA_DIR=/workspace/.tight-data` before starting the server. Do not commit that directory. Automated server and browser tests use separate temporary directories and never use the normal game database.

## Commit behavior

One backend holds an exclusive SQLite lock for its lifetime. Starting another backend with the same directory fails before it starts listening. Closing or force-killing the first process releases the lock; no PID file needs removal.

Game creation, restart, import, and deletion write to SQLite before returning success. A WebSocket command commits its changed game before the next broadcast. If a write fails, the backend restores the previous game, pending broadcast flags, and socket player binding. It closes the sending connection with code 1011, and the interface offers reconnect. HTTP storage failures return 503. Reconnect to inspect the committed state before retrying; command acknowledgments and automatic retries remain tracked in issue #12.

SQLite uses its rollback journal and `synchronous=FULL` for interrupted-write recovery. Games no longer expire after inactivity. Explicit deletion remains permanent in the current database.

## Backups and compatibility

After loading a valid, nonempty database at startup, the backend writes a complete SQLite backup under `backups/`. It keeps the three newest startup backups. These are startup snapshots, not a backup after every move. Keep separate exports for longer-term protection.

An unsupported schema version, malformed saved game, or invalid database stops startup. The backend does not replace the file with an empty database. Version 1 is the initial schema; future migrations must preserve this behavior and add migration tests.

To restore a backup:

1. Stop every backend using the data directory.
2. Copy the entire data directory to a safe location.
3. Replace `games.sqlite` with the desired file from `backups/`.
4. Start the backend and open the saved game's existing code or URL.

Never copy or replace a live database by hand. If SQLite left a rollback journal after a crash, let the backend recover it before attempting manual recovery.

## Export and import API

`GET /api/game/export?gameId=ABCD` downloads a JSON envelope with `format: "tight-game"`, `version: 1`, and the complete game. Missing games return 404.

`POST /api/game/import` accepts the exported JSON with `Content-Type: application/json`, up to 1 MiB. It validates the complete snapshot before writing. An existing game code returns 409 and is never overwritten. Invalid or unsupported exports return 400. Successful imports retain the code, player names, factions, planets, scores, and game status.

The normal request limit remains 64 KiB. Export/import buttons and a saved-game home screen are still tracked in issue #18. These endpoints have the same unfinished authorization model as the rest of the API; permissions remain a release blocker in issue #4.

## Verification

`npm test` runs real backend processes to test committed moves across forced termination, exclusive ownership, restart and deletion durability, backup integrity and rotation, export/import round trips, invalid database preservation, and failed writes. Write failures use SQLite abort triggers in disposable databases, without product-only test switches. CI runs these checks on Windows and Linux, including the minimum Node version on Linux.
