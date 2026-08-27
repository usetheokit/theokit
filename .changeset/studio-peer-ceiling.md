---
'theokit': patch
---

Widen the optional `@theokit/studio` peer from `^0.2.0` to `>=0.2.0 <1`.

`@theokit/studio@0.3.0` shipped, and a caret on a `0.x` version pins the minor — so `^0.2.0` excluded it. Installing `theokit` alongside the current studio produced an ERESOLVE:

```
While resolving: theokit@0.56.0
Found: @theokit/studio@0.3.0
Conflicting peer dependency: @theokit/studio@0.2.0
```

Nothing about `0.3.0` justified the ceiling: it exports the same single `./plugin` subpath as `0.2.0`, its release changed only its own `@theokit/agents` peer range, and `theokit` reaches it through a runtime `import()` rather than a compiled dependency. The range described a boundary that was never measured.
