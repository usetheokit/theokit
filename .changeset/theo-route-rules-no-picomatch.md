---
'theokit': patch
---

`routeRules` globs are matched by a built-in matcher instead of picomatch, which has an unpatched ReDoS (GHSA-fc5q-39xc-vjpf). `*`, `**`, `?` and `{a,b}` are supported; extglobs are not.
