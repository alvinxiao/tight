# Dependency maintenance

Run `npm ci --legacy-peer-deps`, `npm run audit:runtime`, and `npm audit` before updating a release. CI rejects any reported runtime advisory. The runtime gate requires the npm advisory service to respond successfully; network errors also fail the gate.

The October 22, 2026 update removed unused `superagent`, `cors`, and `ip`, replaced the address lookup with Node's network-interface API, removed unused Babel CLI, and replaced nodemon with Node's built-in watch mode. Express, ws, Babel, lodash, React Router, webpack, and their transitive dependencies were updated. The development toolchain now requires Node 22.15 or later. CI covers that minimum and Node 24.19.

## Remaining development advisories

The complete installed graph reports four high-severity affected entries, all through webpack-dev-server 6.1.0: webpack-dev-server, http-proxy-middleware, micromatch, and braces. They share [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack exhaustion when parsing deeply nested glob patterns. The current upstream chain has no patched compatible release. Do not accept npm's proposed downgrade to webpack-dev-server 1.x.

The application's development proxy patterns are fixed in `webpack.config.ts`; users cannot supply glob patterns through the game interface. The development server binds to 127.0.0.1. It is never included in the packaged desktop app or started by `npm start`, which runs the production server directly. Do not expose the development server to the LAN. This assessment expires November 22, 2026; recheck the advisory and upgrade or replace the development proxy before that date. Issue #5 remains open until this chain is fixed.

## Windows dependency inventory and notices

The packaging script generates `runtime-dependencies.json` and `THIRD-PARTY-NOTICES.txt`, both inside the app archive and beside the executable. The inventory records the production dependency closure from the lockfile, with exact versions, integrity hashes, source URLs, and declared licenses. It deliberately includes production dependencies used only during browser bundling. Build and watch tools are excluded.

`scripts/runtime-inventory.mjs` verifies installed versions and copies actual published license/notice files. Missing notices fail packaging. cookie-signature publishes its license in its README. is-in-browser 1.1.3 declares MIT but omits the notice file; a copy from its upstream project, with its source commit URL, is retained under `docs/licenses`. Electron's own license and Chromium notices remain in the packager output. These files support release review; they do not replace the final license review for distribution.

## Installer build tool

The installer uses electron-builder 26.15.3. Its app-builder-lib dependency is overridden to @electron/get 5.0.0, the same downloader major already used by the desktop packager. Earlier downloader versions pull an unpatched sprintf-js denial-of-service advisory through their proxy logger. This override removes that build-only chain and requires Node 22.12 or later; the project already requires 22.15. The downloader API loads on the minimum Node version, and Windows CI must build and exercise the resulting installer before this dependency change lands. The complete audit retains only the four development-server advisories described above. Recheck this override with each electron-builder update.
