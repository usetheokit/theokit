# OC-35 verification status

On 2026-11-05, the requester explicitly directed OC-35 to be recorded as out
unless passing live-check evidence and the model name could be supplied.
`human/requester` identifies that instruction; no personal name was supplied.

The sandbox has no model credentials, so the real-model end-to-end check was
not run. Offline sample import and startup tests cover instructions, MCP
servers, skills and memories for Claude Code and Hermes. These checks do not
establish live-model parity.

Before marking OC-35 shipped, run
`apps/theoclaw/tests/live/migration.live.test.ts` with credentials and
`THEOCLAW_LIVE=1`, and record the passing evidence and actual model name in the
ledger.
