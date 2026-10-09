---
'@theokit/agents': minor
---

`createA2ATool` no longer returns an empty string when the remote's frames could not be read. The wire parser drops a frame with invalid JSON or an unknown variant; when every content frame was dropped and the stream still finished, the tool returned `''`, the same answer as an agent that chose to say nothing. A turn that finished with no text after dropped frames now rejects with `A2A call to "<name>" failed: the stream finished with no text after <n> frames the reader could not read`. A turn with text beside a dropped frame still returns the text.

`consumeUIMessageStream` and `responseToChunkStream` (`@theokit/agents/client`) accept an optional third argument passed to the wire parser, so a caller can hear the frames it drops through `onWarn`. (B-407)
