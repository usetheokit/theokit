---
'@theokit/agents': major
---

**Breaking:** `CheckpointOptions` is narrowed to `{ resumeSignal?: boolean }`. `storage`, `strategy`,
`maxCheckpoints` and `ttl` are removed, along with the `CheckpointStorage` and `CheckpointStrategy`
types.

The option read as a durable-checkpoint configuration and was a signalling flag: four fields
declared, exactly one ever read, as an `=== 'filesystem'` equality deciding whether a
`checkpoint_saved` event is emitted. `'drizzle'` and `'redis'` were indistinguishable from
`'memory'` in every code path.

The warning that pushed authors toward `'filesystem'` is gone. It said that value "selects the SDK's
durable conversation store"; the SDK persists every session to its transcript regardless, so it
selected nothing — and on a pod with no volume it named the one storage that is unreachable.

**Migration:** delete the removed fields; they configured nothing. `storage: 'filesystem'` becomes
`resumeSignal: true` if you want the `checkpoint_saved` event. Resume itself is a property of the
SDK's session transcript and needs no option.
