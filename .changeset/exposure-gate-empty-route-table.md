---
'theokit': patch
---

The public-exposure gate no longer reads an empty route table as "nothing is exposed".

An app that serves entirely through controllers writes `routes: []` into its manifest — the scan
behind that array reads `<serverDir>/routes` only, and controllers ship as a separate
`controllers.json` by design. `cannotAnswer` was written for a different absence (a manifest built
before `publicMethods` existed) and detects it by asking whether any route declares a mutating
method. On an empty table both questions answer false, so the gate returned `allowed` and bound a
public interface without a word, while a controller declaring `@SetMetadata('theokit:public', true)`
on a POST was reachable on it.

`start` already resolves `dist/controllers.json` to decide whether to serve controllers at all, so
the gate now receives that fact rather than inferring it. An app with no routes and no controllers
is still `allowed` — warning about an app that serves nothing is the noise that gets a gate switched
off. An unstated `hasControllers` is read as unknown rather than as false: absence is not safety,
including in the field that reports the absence.

`TheoManifest.routes` now documents what it counts, so the next reader does not have to measure it.
