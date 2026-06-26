---
"@theokit/agents": minor
---

V4-S: `plan-act-reflect` defers the continuation decision to the `ReflectionStrategy`.

`resolveLoopStrategy('plan-act-reflect')`'s `shouldContinue` is now `round < maxIterations` (instead of the `finishReason === 'tool-calls'` gate). The reflective loop ANDs `reflection.continue` with `shouldContinue`, so this lets a custom `ReflectionStrategy` extend even a terminal (`stop`) round — e.g. "you answered without editing any file; make the edit now" — within the iteration ceiling. Backward-compatible with the shipped `ladderReflectionStrategy` (which itself returns `continue: true` only on `tool-calls`, so the observable behavior with the default ladder is unchanged). `react` is unchanged (the `noop` reflection means the strategy stays the gate: continue only on `tool-calls`). Closes the last seam for an app whose reflection ladder fires on final-answer rounds (theocode's `reflect_no_edit`/`verify`/`fix`).
