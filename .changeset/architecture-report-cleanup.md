---
"theokit": patch
---

Internal architecture cleanup — no public API or behavior change:

- The framework now enforces module `_internal/` privacy at the architecture-boundary level (a build-only guard; nothing changes at runtime).
- `core/` is kept free of Node built-in imports; the public `validateProjectStructure` export is unchanged.
- The Vite integration no longer depends on the framework server's internal file layout, so internal reorganizations won't ripple into build tooling.
