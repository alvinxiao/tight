# Recovering from connection failures

Browser HTTP requests have a 15-second deadline, including reading the response body. Catalog, game, and saved-game requests share this boundary. Catalog failures show a retry action rather than leaving the app on a spinner.

Create, join, and restart dialogs allow only one pending request. Closing a dialog cancels its request and ignores its eventual result. A failed or timed-out request releases the submit button and preserves the form. Create and restart failures ask users to inspect saved games or the current state before retrying, because losing an HTTP response does not prove the host rejected the change. Requests are never replayed automatically.

WebSocket connections have bounded opening waits and five attempts with a three-second delay. Closing or unmounting the app clears retry timers and detaches the active connection. Policy and storage closures require an explicit reconnect. Sending while disconnected immediately offers Reconnect instead of silently dropping the command. Player registration waits for the player to appear in the game state and stops waiting after 15 seconds.

This does not provide command acknowledgments, revisions, or idempotent mutations. A successful WebSocket `send` means only that the browser queued bytes. Issue #12 tracks confirmation after durable writes and safe handling of ambiguous results. On an uncertain result, reconnect to inspect the host's saved state.

Browser regressions exercise HTTP errors, a stalled request, dialog cancellation, catalog retry, and a command attempted after a real socket closes. Native desktop tests exercise quitting, reopening, and restarting the utility process.
