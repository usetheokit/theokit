# 0035: The API stability policy is recorded in theokit-sdk

- Status: Accepted
- Date: 2026-11-12
- Record: `packages/sdk/docs/adr/api-stability-policy.md` in `usetheokit/theokit-sdk`, proposed in https://github.com/usetheokit/theokit-sdk/pull/1107 and accepted in https://github.com/usetheokit/theokit-sdk/pull/1113

## Decision

The stability policy for every published package of both repositories lives in one record, in
theokit-sdk, so the two repositories cannot drift into two policies. It covers `theokit`,
`@theokit/agents`, `@theokit/agents-pty`, `@theokit/http`, `@theokit/presenter`, `@theokit/tauri`
and `create-theokit` here, alongside the SDK packages.

In short, the record sets stability tiers declared by a TSDoc `@experimental` tag (untagged means
stable), a deprecation window of at least 90 days and at least 2 further minors before a stable
export is removed, whichever ends later, `./internal/*` subpaths as the channel for satellite
packages, the removal of test-only `_reset*` helpers from published entries, and a public-surface
diff gate in CI. Packages still at `0.Y.Z`, `theokit` among them, treat the `0.Y` bump as the
breaking bump.

Paulo accepted that record as proposed on 2026-11-12. Whether `theokit` moves to 1.0 is deferred to
a later decision. Read that record for the context, the measurements and the alternatives.
