---
'@theokit/http': patch
---

### Fixed

- `resolveOrNew` no longer swallows every container error and builds the class with no arguments. It falls back to `new Ctor()` only when the container has no registration for the class itself; a missing dependency, scope violation, cycle or throwing constructor now propagates.
