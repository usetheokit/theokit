---
'@theokit/agents': patch
---

Fix the reflective loop's `no_progress` detector being defeated by narration drift (theokit#53). `roundSignature` folded the assistant's text into the per-round fingerprint, so a model that re-ran identical tool calls while rephrasing its prose ("…e executá-lo." → "Agora vou executar…") produced a different signature each round and evaded `NO_PROGRESS_THRESHOLD` — the loop spun (observed live: deepseek-v3.2, 7 rounds / 12 tool-calls re-doing the same `write_file`+`shell_exec`). The signature now keys on the tool-call set ONLY (name + canonicalized input), excluding narration — mirroring opencode's `doom_loop`. Repeated identical tool calls now terminate `no_progress` within 2 rounds regardless of what the model says around them; genuinely varying tool inputs still count as progress.
