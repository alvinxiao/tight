# TIGHT

## Twilight Imperium Game Helper and Tracker

# Build and Run

### Prerequisites

For HTTPS, set environment variables for the paths to key and crt files:

- SSL_TIGHT_KEY_PATH
- SSL_TIGHT_CRT_PATH

To use HTTP instead, set the environment variable TIGHT_USE_HTTP=true.

### 1. Install node modules

`npm ci --legacy-peer-deps`

Use Node 24.19.0 (recommended) or at least 22.15.0. CI covers both versions. The legacy peer-dependency option is required by the current dependency graph.

### 2. Build server and client

`npm run build`

### 3. Run server

`npm run start`

Server URL will be printed in the console.

# Run Dev

Install with `npm ci --legacy-peer-deps`, then run these in separate terminals:

1. `npm run server:dev` builds and watches the backend.
2. `npm run client:dev` builds and watches the browser assets on disk.
3. After both builds finish, run `npx cross-env TIGHT_USE_HTTP=true TIGHT_HOST=127.0.0.1 PORT=3000 TIGHT_DATA_DIR=.tight-data/dev npm run start:dev`.

Open the host-claim URL printed by the server to authorize the browser, then use `http://127.0.0.1:3000/`. This development command uses a separate data folder and binds to loopback. The backend serves the watched browser assets and API from the same origin. Reload the page after a browser rebuild; Node's watch mode restarts the backend when its bundle changes. A separate development proxy and hot module replacement are not used.

# Regression tests

Run `npm test`. This builds the server and runs the Node test suite against a disposable server on an OS-assigned port. It does not use or stop your development server.

The suite covers malformed WebSocket framing, payload limits, configured round limits, planet ownership, deletion broadcasts, API errors, and endpoint origins. CI runs installation, tests, and the client build on Linux and Windows. Native desktop packaging is tracked separately.

`PORT=0` requests an available server port. The startup log reports the bound port. Both browser HTTP requests and WebSocket connections use the actual page origin. Development browser assets, HTTP requests and WebSocket connections use the same backend origin.

# Production-readiness work

See [the backlog](docs/production-readiness.md), [GitHub issue links](docs/readiness-issues.json), and [the Windows desktop design](docs/desktop-design.md). Games now persist in a per-user SQLite database. An Electron preview supports explicit Wi-Fi sharing, paired devices, and host/player permissions. Full game-rule enforcement, signed installation, and physical Windows/phone qualification remain pending. The application is not yet production ready.

## Request validation

REST mutation bodies, API queries, WebSocket handshake queries, and all 28 supported client commands are parsed before game logic runs. Unknown fields and invalid nested shapes are rejected. Game-dependent validation checks faction and player references, indexes, setup requirements, pick orders, and phase jumps. REST validation returns JSON errors. Invalid WebSocket commands close the offending connection with code 1008 and offer a reconnect action in the app; malformed JSON uses 1007, binary commands 1003, and oversized frames 1009. Healthy connections stay open.

The current limits follow the setup UI: 1–8 factions, 1–20 rounds, and 1–20 target points. Each game accepts up to 32 player names, each 1–80 characters. Public objectives are limited to 50 entries, with unique IDs from 1–100, descriptions up to 1,024 characters, and point values from 1–10. There are exactly three secret-objective slots. Modifier and extra-point counters are bounded to -100–100. Ordinary JSON bodies and WebSocket frames are limited to 64 KiB; game imports allow 1 MiB. Sparse public-objective checkbox arrays normalize JSON `null` holes to `false`.

These checks validate input and references; they do not grant authorization or implement every game-rule prerequisite. Host/player permissions are enforced separately. Acknowledgments, full rule tests, and field-level validation feedback remain tracked in the backlog.

## Browser tests

Run `npx playwright install chromium` once, then `npm run test:browser`. This builds the application, checks browser test types, and runs three real Chromium journeys. They cover a host starting a two-faction game, an independent phone-sized guest joining, Unicode names after reload, create/join/restart failures and retry, invalid URL recovery, and saved-game resume/export/import/deletion with retries. The tests start their own server on port 18743 and refuse to reuse an existing server.

In this cloud environment, use the installed system browser without downloading another copy: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`. Linux CI installs Chromium and runs the same browser tests after building. Windows CI runs the server regressions, client build, and browser-test type check. Real-phone networking and native Windows packaging still require separate validation.

## Saved games

Games survive backend restarts and no longer expire after four hours. See [storage and recovery](docs/game-storage.md) for data locations, backups, export/import, and failure behavior. Set `TIGHT_DATA_DIR=/workspace/.tight-data` when developing in this cloud workspace. The home screen lists saved games with resume, export, import, and confirmed deletion. Paired device credentials persist across browser sessions; host and player permissions are enforced. Further identity and resume improvements remain tracked in #18.

## Windows desktop preview

See [the desktop guide](docs/windows-desktop.md) for the preview artifact, development commands, storage, and validation limits. The launcher manages its own backend and requires no separate Node installation for users.

## Network boundaries

The backend rejects unexpected Host headers and foreign browser origins for HTTP and WebSocket requests. See [network boundaries](docs/network-boundaries.md) for supported addresses, development proxy behavior, and the remaining authentication work.

Dependency audit policy, remaining development advisories, and packaged notices: [dependency security](docs/dependency-security.md).

Device permissions and pairing: [access sessions](docs/access-sessions.md). Standalone browser hosts must open the one-use **Host access** URL printed at startup; visiting the address without a valid device cookie shows the pairing screen.
