---
"theokit": patch
---

Loading several TypeScript files that Node cannot load directly (`theo.config.ts`, a cron, a job) in one process no longer stalls on Node 22.12. (#971)

When Node could not import such a file itself, theokit fell back to tsx's `tsImport()`, which registers another loader hook on every call and never removes it. On Node 22.12, the floor `engines.node` declares, the fourth or fifth load in the same process waited forever. theokit now registers one tsx namespace on first use and reuses it, so a file already loaded comes from the module cache, as it does on the native `import()` path.
