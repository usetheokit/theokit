---
'@theokit/agents': minor
---

Inject a custom loop stop-criterion via `AgentRunnerBuilder.loopStrategy(custom)` (M54).

The runner already let you inject reflection, compaction, and the round stream factory; the stop
criterion (`LoopStrategy.shouldContinue`) was the one axis locked to three built-in names. Now:

```ts
const stopWhenConfident: LoopStrategy = {
  name: 'confident',
  maxIterations: 8,
  shouldContinue: (o) => !o.responseText.includes('confidence: high'),
}
AgentRunner.fromSpec(spec).loopStrategy(stopWhenConfident).build()
```

The injected strategy WINS over the strategy the spec's name would resolve to, exactly as
`.compaction()` outranks the spec.

**The ceiling is now the runner's guarantee, not each strategy's convention.** Previously the three
built-ins embedded `round < maxIterations` inside their own `shouldContinue`, so a custom that never
returned `false` would loop forever. The runner now caps every strategy at `maxIterations` — a
`shouldContinue: () => true` terminates at the ceiling with `finishReason: 'step_limit'`.

**Type change (note):** `LoopStrategy.name` is now `string` (was the `'simple-chat' |
'plan-act-reflect' | 'react'` union) so a custom can name itself freely. The internal resolver still
validates the three built-in names via Zod; a custom never passes through it. Code that reads
`strategy.name` expecting the exhaustive union should widen to `string`.
