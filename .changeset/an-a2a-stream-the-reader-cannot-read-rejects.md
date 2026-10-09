---
'@theokit/agents': minor
---

`createA2ATool` no longer returns an empty string when the remote's frames could not be read. The wire parser drops a frame with invalid JSON or an unknown variant; when every content frame was dropped and the stream still finished, the tool returned `''`, the same answer as an agent that chose to say nothing. A turn that finished with no text after dropped frames now rejects with `A2A call to "<name>" failed: no text after <n> unreadable frames`. A turn with text beside a dropped frame still returns the text.

`ChunkStreamOutcome` (`@theokit/agents/client`) gains an optional `framesDropped`, the count of frames the wire parser discarded, which `consumeUIMessageStream` reports; `responseToChunkStream` accepts an optional `onWarn` that hears each discarded frame. (B-407)
