---
"theokit": patch
---

`theokit` requires vite `^7.3.7`, the first 7.x release with GHSA-587h-7wmj-h5pm fixed (vite 7.0.0 to 7.3.6 bundles a launch-editor with a high-severity advisory). The range read `^7.0.0`, so an app could install a vulnerable vite; an app on vite 7.0 to 7.3.6 now gets 7.3.7 on install. (B-560)
