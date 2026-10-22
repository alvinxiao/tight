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

Use Node 24.19.0 for the same runtime as CI. The legacy peer-dependency option is required by the current dependency graph.

### 2. Build server and client

`npm run build`

### 3. Run server

`npm run start`

Server URL will be printed in the console.

# Run Dev

## Run each of the following commands in their own separate console.

### 1. Run server in dev:

`npm run start:dev`

Sometimes changes to server files don't hot reload correctly. Run `rs` in this console to restart the server.

### 2. Build and watch server in dev

`npm run server:dev`

### 3. Build and watch client in dev:

`npm run client:dev`

Access the client at https://localhost:3001/

# Regression tests

Run `npm test`. This builds the server and runs the Node test suite against a disposable server on an OS-assigned port. It does not use or stop your development server.

The suite covers malformed WebSocket framing, payload limits, configured round limits, planet ownership, deletion broadcasts, API errors, and endpoint origins. CI runs installation, tests, and the client build on Linux and Windows. Native desktop packaging is tracked separately.

`PORT=0` requests an available server port. The startup log reports the bound port. Both browser HTTP requests and WebSocket connections use the actual page origin. The client development server proxies `/api` and `/socket` to the backend on port 80 in HTTP mode, or port 443 in HTTPS mode.

# Production-readiness work

See [the backlog](docs/production-readiness.md), [GitHub issue links](docs/readiness-issues.json), and [the Windows desktop design](docs/desktop-design.md). Games are still held in memory, permissions and command-specific validation are incomplete, and Electron packaging has not started. These first fixes do not make the application production ready.
