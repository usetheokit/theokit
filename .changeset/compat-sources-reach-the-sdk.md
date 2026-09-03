---
'@theokit/agents': minor
---

**`compatSources` reaches the SDK, and says so when the installed SDK cannot hear it** (#634).

`@theokit/sdk` stopped reading `<cwd>/.claude/` unconditionally (`theokit-sdk#524`) and put it
behind `local.compatSources`. This layer had no way to forward that, so an agent built here could
not opt into the foreign dialect at all.

The issue held the work back for a real reason: forwarding an option an older SDK does not know
would be **silently inert** — the operator declares it, nothing reads `.claude/`, and no message
explains why. The silence turns out to be removable from this side. `@theokit/sdk` declares
`"./package.json"` in `exports` — verified on **4.52.1**, the oldest version a consumer can have
today, not only on the 5.x prerelease — so the installed version is readable at runtime and a
mismatch warns once per process. The floor stays `^4.52.1`; nobody is pinned to a prerelease.

Declaring the dialect goes through `settingSources`, next to the roots it already gates:

```ts
settingSources: {
  project: { trustedBy: posture },
  claudeCode: { trustedBy: posture },   // reads <cwd>/.claude/
}
```

**Two questions, answered by two different halves of that field**, because the SDK's own docblock
separates them: *declaring* the field answers "do I want another product's configuration imported?"
(omitting is not enabling), and the `TrustPosture` inside answers "do I trust this directory's code
to run?". The grant is `ProjectSettingsGrant` — the same type `project` takes — not because the
questions are the same, but because a separate `'foreignDialects'` capability could not carry the
distinction: `TrustPosture.allows` is `Record<K, boolean>` whose values all move with the trust
level, so a second name would promise an operator a choice `resolveTrustPosture` never gives them.

This is deliberately **stricter than the SDK**, where listing a dialect is sufficient: `.claude/`
holds a `hooks.json` that executes shell, in a directory that usually arrived with the clone.
