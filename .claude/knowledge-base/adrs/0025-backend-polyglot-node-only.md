# ADR 0025 — `--backend` polyglot is Node-only (Python deferred)

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** project owner

## Context

`create-theokit --backend <kind>` scaffolds a polyglot sidecar service next to
the app (proxied via `services: {}` in `theo.config.ts`). The code (`scaffold-services.ts`)
supported `python` and `node`, but **both service templates were deleted** by the
stale-cleanup commit `fc3f49b` — so every `--backend` scaffold failed (no template
to copy). The prior Ecosystem rule stated "Wave 2 backends are Python + Node".

## Decision

**Ship Node-only.** `--backend node` is the single supported polyglot backend.

- Restored the `agent-node` (Hono worker) service template from history (`2d1b5e3`) into `packages/create-theokit/templates/services/agent-node/`.
- `BackendKind` narrowed to `'node'`; `VALID_BACKENDS = ['node']`; `parseBackendFlags` now rejects `python` (and every other value) with the standard "unknown --backend value" error.
- Removed the Python branch from `BACKEND_CONFIG`.
- Updated both `scaffold-services` test suites (root + package-level) to node-only.

Python is **deferred**, not banned. Re-adding it requires restoring the
`agent-python` template + this ADR superseded with demand evidence (matches the
ADR-0011 gate pattern).

## Alternatives considered

1. **Restore both Python + Node templates (rejected).** The owner narrowed scope to Node-only; carrying a Python (FastAPI/uvicorn) template doubles the maintenance surface for a backend with no current demand signal.
2. **Remove `--backend` entirely (rejected).** The Node (Hono) sidecar is a real, tested capability worth keeping; only the unbuilt Python half is dropped.

## Consequences

- `create-theokit --backend node` scaffolds a Hono worker sidecar; `--backend python` now errors clearly.
- Supersedes the "Python + Node" half of the Ecosystem rule for `--backend` (the Ecosystem table's Wave 2 line is updated to Node-only).
- `scaffold-services` suites are green against the restored `agent-node` template.

## References

- Service template restored from `2d1b5e3`.
- Stale-cleanup root cause: `fc3f49b` (see ADR 0024).
- Template-set convergence: ADR 0023 (default-only).
