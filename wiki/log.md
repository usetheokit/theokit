# Wiki change log

## 2026-08-06

* **Creation**: The bundle was created by migrating the two pre-existing knowledge trees,
  `docs/` (23 authored documents) and `knowledge-base/` (48 documents), into 72 concepts under
  OKF v0.2. Bodies were carried over unchanged; what was added is frontmatter, a cross-linked
  graph, and per-directory indexes. Both source trees were removed in the same change, so this
  bundle is now the only copy of that material.
* **Update**: The 15 generated `phase-0-typecheck-pre-flight-YYYY-MM-DD.md` records were folded
  into one concept, [Phase 0 typecheck pre-flight gate](/gates/typecheck-pre-flight.md), which
  carries every recorded run in a table. They were test output, not authored knowledge, and
  `tests/integration/typecheck-clean-gate.test.ts` now writes them to the gitignored
  `.audit/typecheck/` instead of into this bundle — a generated file without frontmatter would
  break the bundle's one hard rule.
* **Update**: Domain frontmatter keys were carried over intact, except three renamed to avoid
  colliding with OKF vocabulary: `status` became `record_status` (its values were
  `completed`/`shippable`, outside OKF's `draft|stable|deprecated`), `generated_by` became
  `produced_by`, and `generated_on` became `produced_on`. OKF's own `generated` names the
  original producer where the source recorded one and `theokit-agent/unrecorded` where it did
  not; `migrated` records this migration separately, so authorship is not confused with
  relocation.
* **Boundary recorded**: `knowledge-base/references/` — a 165 MB read-only clone of the
  `opencode` peer project — was **deliberately excluded** from this bundle. Per
  `.claude/rules/reference-provenance.md`, third-party study material must not be copied into
  the project, so none of its content was migrated. Only our own curated metadata about it
  survives, as [Peer reference catalog](/references-catalog.md). That catalog describes clones
  that no longer exist on disk; re-clone from the upstream URLs it lists if the material is
  needed again.
* **Not claimed**: no concept carries a `verified` event. Nothing in this bundle has been
  confirmed by a human or a process since migration, and seeding the field would misreport the
  trust tier a consumer computes.
