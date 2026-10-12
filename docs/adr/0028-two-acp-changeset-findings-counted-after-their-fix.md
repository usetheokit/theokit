# 0028: Two ACP changeset findings the code review counts after they were fixed

- Status: Accepted
- Date: 2026-10-11
- Deciders: the repository owner, in the S-001 ship session for `theo-acp-tool-handshake` (B-408)

## Context

The `loop-code-review` audit of `theo-acp-tool-handshake` at `534e7149` returns `BLOCKING_FINDINGS`
with two blocking ids:

- `LCR0202@.changeset/an-acp-agent-cannot-crash-or-outlive-its-call.md#L5` (finding #65)
- `LCR0202@.changeset/an-acp-tool-call-closes-on-json-that-is-not-json-rpc.md#L5` (finding #66)

Both release notes said a stdout line that breaks the ACP protocol rejects the call with
`AcpTransportClosedError` (reason `broke the ACP protocol: ...`). Since `1b4769d9` and `c324f68a` the
tool passes the client's typed error through, so the call rejects with `AcpProtocolError` from
`@theokit/agents`. A consumer writing a `catch` from the CHANGELOG would have missed every protocol
break.

`534e7149` rewrote both notes to name `AcpProtocolError` (code `ACP_PROTOCOL_ERROR`, carrying the
offending `line`). The audit was rerun at `534e7149` on the same database. It set both rows to
`status = fixed` and says so in its own report ("Status at 8b9305fe: fixed"), but `count-blocking`
does not filter on `status`, so the computed verdict still counts them. ADRs 0026 and 0027 record the
same behaviour for B-416 and B-404.

Measured at `534e7149` on 2026-10-11:

- `git grep "broke the ACP protocol" -- .changeset` prints nothing.
- `npx vitest run tests/unit/acp-tool.test.ts packages/theo/tests/server/an-acp-tool-call-releases-its-agent-process.test.ts`:
  2 files, 24 passed. Among them, `test_a_protocol_break_on_an_injected_transport_rejects_with_the_protocol_error`
  and the three cases of `test_a_json_line_that_is_not_a_json_rpc_message_rejects_the_call_typed`,
  which pin the behaviour the notes now describe.

## Decision

The two ids are read as fixed by `534e7149` and do not block this item's review. Any other blocking
finding of the audit, or either note going back to `AcpTransportClosedError`, still blocks. The
open medium and low findings of the same audit are not blocking and are not dismissed here.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0202@.changeset/an-acp-agent-cannot-crash-or-outlive-its-call.md#L5: fixed in 534e7149, tests pinning AcpProtocolError green at 534e7149; the audit itself records status fixed; its count ignores status (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0202@.changeset/an-acp-tool-call-closes-on-json-that-is-not-json-rpc.md#L5: fixed in 534e7149, tests pinning AcpProtocolError green at 534e7149; the audit itself records status fixed; its count ignores status (this ADR) -->

## Considered options

1. **Record the fix and read the two ids as closed** (chosen). It uses the audit's own record of the
   fix and the tests that pin the documented behaviour, with the marker ADRs 0024, 0026 and 0027 use.
2. **Run the audit again on a fresh database.** Rejected for this session: the ship session was told
   not to start auditors, and the rerun that already happened records the fix.
3. **Edit the audit database to drop the rows.** Rejected: it rewrites another tool's evidence.

## Who is affected, and what breaks

Nobody outside the repository. No code changes with this decision. If `loop-code-review` later
filters fixed rows out of its count, these two markers stop matching anything and can be removed.
