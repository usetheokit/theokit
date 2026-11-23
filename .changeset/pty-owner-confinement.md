---
'@theokit/agents-pty': patch
---

`createPtyOwner` takes `env: { keep, home }` to scrub the session environment and `cwd` to pin the working directory; new `probeConfinement(backend, root)` proves a backend writes inside the root and is refused outside it.
