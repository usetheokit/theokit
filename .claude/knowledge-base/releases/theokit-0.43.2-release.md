# Release theokit@0.43.2

**Date:** 2026-07-16
**Verdict:** RELEASED
**Package:** `theokit` (patch 0.43.1 → 0.43.2)
**Mechanism:** changesets + `pnpm publish` (per-package — this repo's actual release model; NOT the generic develop→main-PR + vX.Y.Z flow)
**Source review:** `.claude/knowledge-base/reviews/surface-in-process-agent-stream-errors-review-2026-07-16.md` (READY_TO_MERGE)
**Plan:** `.claude/knowledge-base/plans/surface-in-process-agent-stream-errors-plan.md`
**Release commit:** `837232e2` (release(theokit): 0.43.2 …)
**Fix commits:** `6bcfafa1` (fix) · `029190c0` (review-hardening) · `49daa474` (changeset note)
**Tag:** `theokit@0.43.2` (annotated, pushed)
**npm:** `theokit@0.43.2` published (provenance flip applied — provenance only works in CI; restored `true` after)
**GitHub release:** https://github.com/usetheodev/theokit/releases/tag/theokit%400.43.2

## What shipped (#136)

Surface in-process agent stream errors in the unified client. A provider failure (401/429/5xx) arrives as a `{ type: 'error', errorText }` UIMessage chunk (not a thrown rejection); `consumeChunkStream` now captures it via `readUIMessageStream`'s `onError` + `terminateOnError` and rethrows, so `AgentClient`/`useAgent` settle to `status: 'error'` with `error.message` set instead of silently ending in `'done'`. A failed turn is now visible (e.g. the scaffold's `<Notice variant="error">` renders) instead of a dead UI. Fixes both the in-process (TUI/desktop) and HTTP/SSE (web) paths; the stale-drive abort path is covered so an aborted turn's error chunk never clobbers a newer live turn.

## Notes

- `changeset version` also bumped 3 `private: true` fixtures (`services-both`, `services-node-basic`, `services-python-basic`) to keep their `workspace:*` theokit dep in sync — NOT published.
- Template pin synced `theokit ^0.43.1 → ^0.43.2` (`packages/create-theokit/templates/default/package.json.tmpl`). The published `create-theokit@1.20.1` still pins `^0.43.1`, which via caret already resolves to `0.43.2` — existing scaffolds pick up the fix automatically; the sync keeps the source consistent for the next `create-theokit` publish.
- The generic `/release` develop→main-PR + `vX.Y.Z` flow was deliberately NOT used — this repo releases per-package via changesets + pnpm (per-package tags like `theokit@0.43.2`). User confirmed the changesets+pnpm path.
