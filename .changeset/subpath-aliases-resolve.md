---
'theokit': patch
---

Every published subpath of `theokit` resolves in dev again.

A Vite alias whose `find` is a **string** matches by prefix, and every entry in the plugin's alias
cascade pointed at a *file*. So `theokit/client` → `client/index.ts` rewrote `theokit/client/core`
into `…/client/index.ts/core`, and the build died with `ENOTDIR`. The only way around it was to
import the barrel instead, which pulls React into code that was written to avoid it.

The barrels are exact-match now, and one generic rule resolves everything else under the package.
That is the part that matters: the previous fix for this same defect enumerated the known subpaths
and put the bare alias last, which repaired the listed ones and left every unlisted one broken. A
list that must grow with the exports map is the mechanism that failed twice.

Two subpaths do not mirror the source layout and stay explicit — `theokit/react-query` (moved to a
sibling file) and `theokit/devtools/entry` (source carries a `/dom/` segment the dist flattens).

Also fixed by the same change: a package merely *named* like ours — `theokit-anything` — was being
rewritten by the bare prefix alias.
