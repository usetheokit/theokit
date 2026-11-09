---
"@theokit/presenter": minor
---

`ChatPresenter` can stream previews. Set `supportsEdit: true` when the channel can edit a sent message: text events then emit provisional `ChatMessage`s marked `preview: true`, at most one per `previewIntervalMs` (default 1000; `now` injects a clock), and the turn's final message carries `replacesPreview: true` so the adapter edits the earlier message instead of sending a new one. Without `supportsEdit` a turn still emits one message.
