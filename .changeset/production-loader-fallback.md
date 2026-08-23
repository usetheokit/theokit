---
'theokit': patch
---

`createProductionLoader` now loads user-authored `.ts` modules through the importer that carries the
tsx fallback, instead of calling `import()` and relying on the CLI bin having registered a global
`tsx/esm` hook. A caller that reached it any other way — a test booting the real request handler, an
application embedding the framework — failed with `ERR_UNKNOWN_FILE_EXTENSION`, or with
`__filename is not defined in ES module scope`.

Production is unchanged in cost: the importer tries the native import first, so with the hook
registered it takes exactly the path it took before.
