# Desktop Wi-Fi sharing

The desktop keeps its original loopback listener and renderer origin. Enabling sharing adds a second listener bound to one selected private IPv4 adapter, at the same port. Both listeners use one Express app, SQLite writer, session owner, WebSocket server, and broadcast timer. Stopping sharing disconnects LAN clients and closes only that listener; the desktop can keep playing locally.

Two alternatives were considered. Restarting the whole backend on a selected adapter would interrupt the host window and change its origin. Binding a single wildcard listener would expose unselected interfaces. Separate WebSocket servers per listener would also race to consume the shared dirty-game queue. The selected design attaches both listeners to one WebSocket server and retains one broadcast owner.

The native preload exposes only hosting status and selecting or stopping a LAN listener. The main process verifies the sender's main frame, origin, and host cookie before forwarding a request to the backend. The backend rechecks that the address belongs to a current private IPv4 interface. Changes run in sequence. Switching adapters binds the replacement before retiring the old listener; a bind failure leaves the existing host and sharing session available.

The Host and Origin policy accepts loopback and the selected LAN address. Existing player and spectator authorization applies on both listeners. QR invitations contain guest capabilities, never the desktop's host capability. The lobby QR has no credential and lets already-paired devices reconnect using their cookie.

Windows firewall rules are not changed automatically. Users select a trusted private network and allow TIGHT on Private networks if Windows prompts. No router forwarding, internet account, or cloud service is required. Real Windows firewall and physical phone qualification remains tracked in issue #26.

## Joining and troubleshooting

Keep the PC awake and connect phones to the same trusted Wi-Fi. Enable sharing, then create a private invitation with **Pair device** inside the game. The lobby QR only opens the address; it does not grant access to a new device.

If a phone cannot connect, check that Windows permits TIGHT on Private networks and that the router does not isolate guests or wireless clients. Do not enable router port forwarding. Stopping sharing disconnects phones while keeping the desktop game open.

If the selected adapter disappears or its address changes, refresh the network list and select the current adapter. An address change also changes the browser origin, so issue fresh invitations for phones using the new address. Automated tests exercise real interface binding and decode rendered QR images; they do not replace physical phone camera and Windows firewall qualification.
