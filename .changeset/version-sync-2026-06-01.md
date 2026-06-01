---
'theokit': patch
'create-theokit': patch
---

chore: align theokit + create-theokit versions to 0.2.1 (changeset-link invariant)

No functional changes. `create-theokit` was bumped to 0.2.1 on 2026-05-30 to ship the stranger-template fix (`openai/` model prefix). `theokit` was left at 0.2.0; this changeset realigns them so the `.changeset/config.json` `linked` invariant (`tests/smoke/changeset-config.test.ts:50`) is satisfied. Per `tests/smoke/changeset-config.test.ts` and ADR 0019 (template version sync gate), `theokit` and `create-theokit` MUST stay version-locked.
