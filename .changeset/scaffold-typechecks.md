---
'create-theokit': patch
---

A freshly scaffolded app passes `tsc --noEmit` again. The template typed its transcript as
`@theokit/ui`'s `UIMessage` while filling it from `useAgent()`, which returns the framework's wire
message; the two are deliberately different types and neither can be assignable to the other.

The app now types against what it receives and converts at the render boundary, in
`app/lib/renderable.ts` — a projection that validates each part and drops what the installed
component library has no renderer for, with no casts. A new CI job scaffolds the template and
typechecks it against the packages a real user installs, which is what neither #80 nor #396 had.
