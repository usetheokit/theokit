---
'theokit': minor
---

`theokit build` refuses a target that cannot enforce a rate limit the config declares.

A rate limit is applied by the `node` target and by none of the six Web-standards targets. Until now the build printed a warning among others and carried on, so a `theo.config.ts` that reads as protective produced a deploy with no limit and nothing at runtime to report the absence. The first sign is the abuse it was meant to stop.

`#321` and `#322` are the same lesson, twice, both closed: **a rate limit that silently does not apply is worse than one that is absent, because the operator stops looking.** So this combination is now refused by name, before the build writes anything — the answer this framework already gives an undeclared route policy (`MissingRoutePolicyError`) and an unauthenticated write on a public bind (0.54.0).

**To upgrade.** If your build now fails, the deploy it used to produce was unprotected. Two ways forward, and the message names both: build for `node` and run `theokit start`, which applies the limit; or remove `rateLimit` so the file states what actually runs.

**There is no flag to keep the key and skip the check.** A config that stays while doing nothing is the state this refusal exists to end.

Deliberately narrow: only `rateLimit`. A dropped `cors` or `serialization` degrades where someone can see it and the existing warning is proportionate — escalating every concern would turn a useful warning into a wall people learn to skip.

This does **not** wire the limiter into those targets. That needs per-runtime address resolution, and doing it naively gives five of six a single shared bucket keyed on `0.0.0.0` — every visitor counted as one caller, a self-inflicted denial of service shipped under a config the operator trusts. Refusing is the honest half that can ship today; the wiring stays open in #461.
