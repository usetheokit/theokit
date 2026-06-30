---
'theokit': patch
---

Fix `theokit build --target theo-cloud` rejecting the current manifest schema. The manifest builder emits `version: 2` whenever a project name is configured, but the TheoCloud adapter hard-rejected anything other than `version === 1`, so the build failed the version gate before producing any artifact (usetheodev/theokit#9). The adapter now accepts both v1 (deprecated) and v2 manifests and reports the consumed `schemaVersion`; truly unknown versions still throw the forward-compat guard.
