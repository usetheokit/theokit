---
"@theokit/tauri": minor
"create-theokit": patch
---

`createTauriChannelSource` and `createTauriAgentClient` take an optional `cancelCommand`. When it is set, aborting a desktop turn invokes that Tauri command (the desktop template's `cancel_turn`), so a stop button stops the turn instead of waiting for the next message. A rejected cancel command reaches the turn's `onError`; the abort itself never throws. Without the option the abort does nothing, as before. (B-376)

The `create-theokit` desktop template ships a `cancel_turn` command that kills the in-flight sidecar, registers it beside `run_turn` and `approve`, and its webview passes `cancelCommand: 'cancel_turn'`. (B-376)
