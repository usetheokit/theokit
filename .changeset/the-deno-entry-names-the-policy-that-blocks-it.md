---
'theokit': patch
---

The Deno entry names the dependency-age policy that can block its own deploy

Deno refuses an npm version published inside a 24-hour window — a supply-chain protection it applies at resolution time — and the error it raises names the PACKAGE rather than the policy:

    Could not find npm package '@theokit/agents' matching '^15.0.2'.

The range comes from the project's own `package.json`, which the upload carries, so a consumer who scaffolds right after a TheoKit release meets this and has no reason to read it as temporary. The emitted entry now names the policy and the flag that overrides it.

It does not set `minimumDependencyAge`. Lowering it withdraws a protection, which is the project owner's decision and not a code generator's — a default of 0 shipped here would remove it from every consumer silently.
