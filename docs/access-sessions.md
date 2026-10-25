# Local host and paired devices

Access-control contract for issue #4. The desktop starts locally; the host can explicitly enable sharing on a private network.

## Usage and ownership

The backend creates a random host capability at startup. Electron receives it through trusted utility-process IPC and installs an HttpOnly, SameSite=Strict cookie before opening the interface. The standalone server prints a separate one-use host claim URL. Its fragment is exchanged for the cookie and removed from browser history. Neither capability is included in a guest invitation or game export.

The host creates an invitation for one game and an approved player display name, or for a spectator. Invitations expire after five minutes and can be claimed once. Claiming mints a random device capability. Only its SHA-256 digest is stored in SQLite. Player grants survive backend restarts. Pairing a replacement device for the same name revokes its previous grants. The host can revoke all devices and outstanding invitations for a game without deleting its data. Deleting a game also deletes its grants, preventing a later reused game code from inheriting permissions.

A retry from the already-claiming device returns the same grant while the invitation is valid; replaying its link from another browser is rejected. Failed grant writes retain the unused invitation and the previous device grant.

Opening a replacement invitation in the same tab works after a pairing error, from the unpaired screen, or while viewing another game. An invitation fragment triggers a fresh app load so the new device identity replaces the previous session and game state. The existing claim flow removes the fragment before contacting the host. Other URL fragments do not reload the app.

The session module owns credential parsing, invitation consumption, and the permission matrix. The game store owns durable guest grants. HTTP adapters reject unauthorized game operations before invoking their handlers. WebSocket adapters resolve the grant for each command, check game and faction scope, and bind the subscription to that same scope. Display names and four-letter codes never establish permission.

## Permission matrix

| Action | Host | Ordinary player | Table editor | Spectator | Unpaired |
| --- | --- | --- | --- | --- | --- |
| Catalog reference data | Read | Read | Read | Read | Read |
| Game state | Any game | Paired game | Paired game | Paired game | Denied |
| Saved-game administration | Allowed | Denied | Denied | Denied | Denied |
| Setup, faction assignments, game start/end/restart | Allowed | Denied | Denied | Denied | Denied |
| Public faction gameplay | Any faction | Assigned factions | Any faction in paired game | Denied | Denied |
| Private objective editing | Any faction | Assigned factions | Assigned factions | Denied | Denied |
| Public objectives, turn, phase, round, speaker, agenda controls | Allowed | Denied | Allowed in paired game | Denied | Denied |
| Pair, replace, or revoke devices | Allowed | Denied | Denied | Denied | Denied |

A table editor is a paired player whose host explicitly checked **Allow table-wide editing** when creating the invitation. The grant persists in database schema version 5 and applies only to the paired game. It does not expose another faction's unscored private objectives or grant desktop/network administration.

To remove the grant, create a replacement invitation for the same player name with the option unchecked and have the intended device claim it. Claiming replaces the previous device grant and disconnects its sockets. **Disconnect paired devices** immediately revokes all device grants and outstanding invitations for the game.

The host can expand **Connected devices** in the pairing dialog for a live, game-scoped list. Player names and their current table-editing grants appear only while connected. Spectators appear as a device count. Multiple tabs with the same credential count once. The host-only endpoint excludes credentials, hashes, addresses, and private game data. See [connected devices](connected-devices.md) for refresh and disconnect behavior.

## Alternatives

Trusting the game code or chosen name preserves the current impersonation flaw. Trusting loopback addresses alone does not distinguish the desktop host from other local clients and does not extend safely to LAN hosting. Public-key device identities add key management without removing the need for host approval and recovery. Random bearer capabilities with server-side grants fit the local host and browser clients, and support immediate revocation.

## Failure paths

A grant is persisted before a claim is acknowledged. A failed write retains the unused invitation for retry. Revocation is checked for existing sockets as well as new connections. Unsupported storage versions fail without replacing the original database. Migrating version 1 first creates a recoverable backup. UI state reflects the role, while server checks remain authoritative.

## Verification and current limits

Backend integration tests cover anonymous and forged credentials, one-use and expired invitations, lost-response retry, host-only HTTP operations, cross-game and cross-faction commands, read-only spectators, secret objective filtering, revocation of open sockets, failed grant writes, restart persistence, code reuse after deletion, and a recoverable version-one migration. Browser tests cover issuing a player link, using it in an independent phone-sized browser, removing its fragment, and reloading with the device cookie. These are simulated browser clients, not physical Wi-Fi qualification.

Replacement-link browser tests also cover failed player/spectator pairing, an unpaired tab, and switching from a spectator in one game to a player in another. They verify fresh app state, the actual server-issued role and game, retained host-only restrictions, and identity after reload.

The desktop retains its loopback listener while optional Wi-Fi sharing adds one selected private interface. Player invitations include QR codes, and the sharing dialog explains Private-network firewall access. See [Wi-Fi sharing](lan-hosting.md). Physical Windows/phone testing remains tracked in #26. The standalone server can be bound explicitly with TIGHT_HOST and uses the same authorization boundary.

The host is trusted to administer every game, including its private objective data. Paired players receive their assigned factions' private objectives; other unscored descriptions are removed from snapshots and broadcasts. Scored objectives and ended games are public. Display names remain the game's labels and assignment keys; possession of a name never grants access.
