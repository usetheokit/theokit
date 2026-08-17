# SEPA pre-RED — iteration 1 — T1.1+T1.2 (native bindings)

VERDICT: PROCEED_WITH_NOTES

- [MAJOR] Combine T1.1+T1.2 in ONE commit: SOUND (findRebuildCwd's only caller is ensureNativeBindings, same file). Not a multi-task anti-pattern — one cohesive unit.
- [MAJOR] EC-14: decide first-vs-last `/node_modules/.pnpm/` marker DELIBERATELY; EC-1 test passes either way, so pin nested case with explicit test. Keep startsWith(realpath(defaultCwd)) local-guard BEFORE marker slice.
- [MAJOR] TDD-first: add EC-6/7/8/14 RED tests BEFORE impl. Count is advisory (plan says 6/6 and 9/9 inconsistently) — BEHAVIOR is the contract; every named RED green.
- [MINOR] ensureNativeBindings: sentinel keyed `${abi}-${hash(deps+versions)}` (EC-6); CI=true fail-closed no rebuild; EC-7 single rebuild then actionable throw (no recursion); EC-8 ENOENT actionable; never throw on healthy ABI; POSIX-only note (EC-15).
- [MINOR] scripts/ outside package DAG → G6/G8 globs don't apply; pillar (c) relaxes to globalSetup invocation (tests/setup-native-bindings.ts:11); no fabricated metric.

RATIONALE: combining is the only way to satisfy wiring pillar (a) for findRebuildCwd; EC-14 first-vs-last marker is the one real hazard, currently passing by coincidence.
