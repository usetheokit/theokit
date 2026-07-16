---
"theokit": patch
---

Surface in-process agent stream errors in the unified client. A provider failure (401/429/5xx) arrives as a `{ type: 'error', errorText }` chunk rather than a thrown rejection; `consumeChunkStream` now captures it via `readUIMessageStream`'s `onError` + `terminateOnError` and rethrows, so `AgentClient`/`useAgent` settle to `status: 'error'` with `error.message` set instead of silently ending in `'done'`. This makes a failed turn visible (e.g. the scaffold's `<Notice variant="error">` renders) instead of leaving a dead UI. The stale-drive abort path is covered so an aborted turn's error chunk never clobbers a newer live turn. Fixes #136.
