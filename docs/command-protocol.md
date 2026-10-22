# Command confirmation and concurrent edits

Issue #12 needs a durable command identity as well as a connection retry button. A command will carry a UUID, the game incarnation UUID and revision it was based on, and its validated payload. The game incarnation prevents an old command from affecting a deleted and later reused game code. The host has a stable administrative principal; a paired device uses its persisted credential digest as its principal.

The `GameStore.commitCommand` storage API checks for a receipt before invoking the mutation callback. Repeating the same principal, command UUID, and payload returns its committed result. Reusing the UUID with a different payload is rejected. A command based on another incarnation or an older revision is rejected without mutation. The UI must show that rejection and replace its view with the current authorized snapshot; it must not silently rebase an old edit.

A transaction commits the candidate snapshot, its next revision, and its receipt together. No-op commands can keep the revision but still receive a receipt. A failed write rolls back both state and receipt, and the in-memory owner restores its previous state. Acknowledgment is sent only after commit. Other clients receive versioned broadcasts, and reconnect starts with a full authorized snapshot.

Receipts are bounded to the most recent 2,000 per game and 10,000 overall. A pruned command that changed state still has an old revision and cannot apply twice. If a pruned no-op is repeated without an intervening state change, it remains a no-op. Revisions never reset while a game exists, including restart; a newly created or imported game receives a new incarnation.

The client will retain each outstanding command's original ID, payload, and base revision for bounded retry after reconnect. It will not mint another ID or change the expected revision when retrying. Timeouts and disconnections must distinguish an unconfirmed action from one that was rejected. Pending, saved, disconnected, and failed states belong in the interface.

## Implementation sequence

The SQLite revision and receipt transaction is implemented, with migration backups and crash/rollback tests. Existing saves advance their revision when their stored snapshot changes; unchanged saves retain it. Game metadata and receipts stay outside the portable game export. The backend library exports GameStore for storage adapters; its owner must load and validate the store before use and restore any in-memory mutations when a commit throws.

Next connect the validated wire envelope and acknowledgment to that transaction, update the client and integration helpers, and add concurrent-editor, duplicate, reconnect, and lost-response regressions. The trusted adapter must derive the principal from the current authorized session and hash the validated command; the browser must never supply either digest. Until that step ships, existing WebSocket messages still use the earlier unacknowledged protocol; the storage foundation alone does not close #12.
