---
'@theokit/agents': minor
---

An SDK that cannot read a foreign configuration root is now refused with a typed
`CompatRootUnsupportedError`, instead of warned about.

`compatSources` landed in `@theokit/sdk@5.0.0`. Below it the option is accepted and ignored, so every
`.claude/` surface is unavailable while the package resolves, compiles and runs. A `console.warn`
stood there, and its own text named the condition that kept it a warning: "Until this package's floor
can name a stable 5.x". The floor is `^5.3.0`, so the only way to reach that branch is an override —
and an override that silently disables every foreign surface is what a refusal is for.

Separate from `CompatImportUnsupportedError`, which is about narrowing a root the SDK can already
read (5.4.0). Reusing it would name the wrong version and send the reader to the wrong upgrade.
