---
create-theokit: patch
---

The esbuild settings that bundle an Ink CLI ship as `create-theokit/tools/build-ink-cli.mjs`; the scaffolded TUI's `build:bin` calls it instead of carrying its own copy.
