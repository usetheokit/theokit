---
'create-theokit': minor
---

The `tui` surface gains an opt-in `build:bin` script that bundles the terminal app into one ESM file with esbuild, with the externals, `createRequire` banner, Ink devtools stub and React production pin that keep the bundle from failing at runtime.
