# 0033: The `@theokit/agents` root bundle cap stands at 42 000 bytes

- Status: Accepted
- Date: 2026-11-02 (records decisions taken on 2026-10-06 and 2026-10-09)
- Deciders: the repository owner, per the commit messages of `99536de5`, `7c2a3f42`, `22c2becc` and `b27673ab`
- Context: the size gate `agents main bundle under 42KB` in `packages/agents/tests/integration/bundle-size.test.ts`

## Context

`bundle-size.test.ts` fails when `packages/agents/dist/index.js`, the root barrel every consumer
of `@theokit/agents` pays for, reaches its cap. Between 2026-10-06 and 2026-10-09 the cap went
39 200 -> 40 500 -> 41 500 -> 42 000 bytes. A review of that sprint found no ADR and no changelog
line stating the new ceiling or why. Each raise was explained in the test's docblock and in its
commit message, but a reader of the decision log could not find it. This record gathers it.

The three raises, from the commits that made them (sizes are bytes of `dist/index.js`):

| Commit     | Date       | Cap             | Measured before the raise | What did not fit                                                                                                                                                  |
| ---------- | ---------- | --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `99536de5` | 2026-10-06 | 39 200 → 40 500 | 40 328                    | The A2A client reading the served UIMessage event stream (B-407); 39 121 before it                                                                                |
| `7c2a3f42` | 2026-10-09 | 40 500 → 41 500 | 40 488 (12 bytes left)    | `AcpClient` robustness fixes from code review (#69, #70, #71) and B-434; a minimal B-434 alone measured 40 517                                                     |
| `22c2becc` | 2026-10-09 | 41 500 → 42 000 | 41 496 (4 bytes left)     | `AcpProtocolError` and `AcpConnectionClosedError` joining the error taxonomy (#83) and the unmatched JSON-RPC object (#66): 41 556 alone, 41 741 alone, 41 801 both |

In each case the implementation run stopped at the cap and did not move it. The commit message
records that the raise was the owner's decision, on the date shown.

On 2026-10-09 the bundle stood at 41 992 bytes, 8 under the new cap. That time the cap did not
move. `b27673ab` moved `createA2ATool`, `A2AToolConfig` and `A2AAuth` to the `@theokit/agents/a2a`
subpath (decision F-arch-5 of B-407), which brought `dist/index.js` down to 39 332 bytes, with
`dist/a2a.js` at 2 750. `the-a2a-tool-ships-on-its-own-subpath.test.ts` keeps the A2A module out
of the root bundle.

## Decision

The cap stays at 42 000 bytes.

The ceiling was raised three times because `AcpClient` and the A2A client sit in the root barrel
through `export *`, and each fix to them was behavior a consumer needed, measured by building with
and without the change. Moving `AcpClient` to a subpath was rejected in the B-408 section of the
test's docblock: it would break every importer of it from the barrel, `createACPTool` in `theokit`
among them. The A2A client, a lone module most agents never import, was moved instead of raising a
fourth time.

## Measurement on 2026-11-02

Re-measured on `workspace` at `0b8f0620`, after `pnpm build` in `packages/agents`:

- `dist/index.js`: 39 579 bytes (2 421 under the cap)
- `dist/a2a.js`: 2 750 bytes

The published `@theokit/agents@16.1.0` tarball's `dist/index.js` is 39 437 bytes.

## Consequences

- The record of each raise is in two places: the docblock beside the assertion in
  `bundle-size.test.ts`, which a person changing the cap reads, and this ADR, which a reader of the
  decision log finds.
- The history shows one practice, followed every time since B-024: measure the growth by control,
  check whether the module can move to a subpath first, and raise the number only by the owner's
  decision, with the reason written beside the cap. A further raise follows it and amends this ADR
  with the new ceiling and the measurement.
- The 2 421 bytes of headroom on 2026-11-02 come from the A2A move, not from a raise. A gate with
  that much slack approves growth nobody asked about; whether to bring the cap down, as B-024 did
  when it lowered the ceiling to 38 600, is left open here.
