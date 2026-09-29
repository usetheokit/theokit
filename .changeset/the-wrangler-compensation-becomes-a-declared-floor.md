---
'theokit': minor
---

The generated `wrangler.toml` carries no compensation for a dependency's defect; the requirement is declared instead

From 2026-09-26 the config carried `[define] "import.meta.url" = "\"file:///worker\""`. Cloudflare executes
the top-level module during validation, so a dependency that resolves a path at load time refused the whole
upload — every deploy of a project declaring an agent was rejected with code 10021, because the transitive
`@theokit/sdk` did exactly that in `internal/providers/catalog-loader.ts`.

It was never a hidden lie: the emitted comment said what it was and what it was not. What it WAS is
unconditional, permanent, and a substitution — so the NEXT dependency with the same vice would be covered
here in silence, and its symptom would be a wrong path rather than a refusal.

The cause is fixed upstream and published as `@theokit/sdk@5.9.2`. Measured on the published tarball: 254
executable files in `dist`, and ZERO resolve a path at module scope — the five remaining textual hits are
two source maps and three `.d.ts` declarations, none executed.

So the `peerDependencies` floor moves to `^5.9.2`, and the `create-theokit` template pin with it. **That is
the trade**: a declared dependency is the honest form of "this needs a fixed SDK"; a `define` that makes a
broken one appear to work is the form that hides it. A consumer resolving below 5.9.2 now fails at install
with a range it can read, rather than at deploy with `code 10021`.

`@theokit/agents` and `@theokit/presenter` keep `^5.3.0` deliberately. `agents` carries its own guard
forbidding a raise past 5.4, with a measured reason — the features beyond it already throw a typed error
naming the version, so raising would strand consumers to duplicate a refusal that announces itself. It does
not weaken the guarantee: a real install must satisfy BOTH ranges, and `^5.9.2 ∩ ^5.3.0` is `^5.9.2`.

Validated end to end on workerd with the published package and no compensation: the worker loads, `/`
returns a 14889-byte document, and an agent turn streams a real reply in 1.6s and terminates.
