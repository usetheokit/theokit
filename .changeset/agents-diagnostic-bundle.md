---
'@theokit/agents': minor
---

`@theokit/agents/doctor` gained `writeDiagnosticBundle` and `DiagnosticBundleError`: write a masked `.tar.gz` (mode 0600) of diagnostic files, refusing it when a configured secret survived the mask or a file name exceeds 100 bytes.
