---
'create-theokit': patch
---

The `tui` and `desktop` surfaces declare their own `build` script. Both inherited the default
template's `theokit build`, whose first act is to require the `app/` directory the same scaffold
removes — so `npm run build` failed immediately on a correctly scaffolded project. `desktop` now
builds with `tauri build` (whose `beforeBuildCommand` already chains the frontend and the sidecar),
and `tui` typechecks with `tsc --noEmit`, because a terminal app runs from source and has no artifact
to bundle. (usetheokit/theokit#374)
