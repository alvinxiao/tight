# Local host and paired devices

Access-control contract for issue #4. LAN remains disabled in the desktop launcher until these boundaries have been verified.

## Usage and ownership

The backend creates a random host capability at startup. Electron receives it through trusted utility-process IPC and installs an HttpOnly, SameSite=Strict cookie before opening the interface. The standalone server prints a separate one-use host claim URL. Its fragment is exchanged for the cookie and removed from browser history. Neither capability is included in a guest invitation or game export.

The host creates an invitation for one game and an approved player display name, or for a spectator. Invitations expire after five minutes and can be claimed once. Claiming mints a random device capability. Only its SHA-256 digest is stored in SQLite. Player grants survive backend restarts. Pairing a replacement device for the same name revokes its previous grants. The host can revoke all devices and outstanding invitations for a game without deleting its data. Deleting a game also deletes its grants, preventing a later reused game code from inheriting permissions.

A retry from the already-claiming device returns the same grant while the invitation is valid; replaying its link from another browser is rejected. Failed grant writes retain the unused invitation and the previous device grant.

The session module owns credential parsing, invitation consumption, and the permission matrix. The game store owns durable guest grants. HTTP adapters reject unauthorized game operations before invoking their handlers. WebSocket adapters resolve the grant for each command, check game and faction scope, and bind the subscription to that same scope. Display names and four-letter codes never establish permission.

## Permission matrix

| Action | Host | Paired player | Paired spectator | Unpaired browser |
| --- | --- | --- | --- | --- |
| Catalog reference data | Read | Read | Read | Read |
| Game state | Any game | Own game | Own game | Denied |
| Create, import, export, delete, restart | Allowed | Denied | Denied | Denied |
| Setup, assignments, phase and round changes | Allowed | Denied | Denied | Denied |
| Faction gameplay actions | Any faction | Assigned factions in own game | Denied | Denied |
| Pair or replace a device | Allowed | Denied | Denied | Denied |

## Alternatives

Trusting the game code or chosen name preserves the current impersonation flaw. Trusting loopback addresses alone does not distinguish the desktop host from other local clients and does not extend safely to LAN hosting. Public-key device identities add key management without removing the need for host approval and recovery. Random bearer capabilities with server-side grants fit the local host and browser clients, and support immediate revocation.

## Failure paths

A grant is persisted before a claim is acknowledged. A failed write retains the unused invitation for retry. Revocation is checked for existing sockets as well as new connections. Unsupported storage versions fail without replacing the original database. Migrating version 1 first creates a recoverable backup. UI state reflects the role, while server checks remain authoritative.

## Verification and current limits

Backend integration tests cover anonymous and forged credentials, one-use and expired invitations, lost-response retry, host-only HTTP operations, cross-game and cross-faction commands, read-only spectators, secret objective filtering, revocation of open sockets, failed grant writes, restart persistence, code reuse after deletion, and a recoverable version-one migration. Browser tests cover issuing a player link, using it in an independent phone-sized browser, removing its fragment, and reloading with the device cookie. These are simulated browser clients, not physical Wi-Fi qualification.

The desktop preview still binds to loopback. Its pairing links work in another browser on the same PC. LAN interface selection, QR codes, firewall guidance, and physical Windows/phone testing remain separate work. The standalone server can be bound explicitly with TIGHT_HOST and uses the same authorization boundary.

The host is trusted to administer every game, including its private objective data. Paired players receive their assigned factions' private objectives; other unscored descriptions are removed from snapshots and broadcasts. Scored objectives and ended games are public. Display names remain the game's labels and assignment keys; possession of a name never grants access.
