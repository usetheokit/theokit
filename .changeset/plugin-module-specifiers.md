---
'theokit': minor
---

`config.plugins` accepts a module specifier alongside a constructed plugin:
`plugins: ['./src/plugins/audit.ts', inlinePlugin()]`. A string is resolved to that module's default
export by both `theokit start` and the Vite dev server, so one declaration serves both.

This exists because a constructed plugin closes over state and has no literal, which is why no
generated deploy entry could ever carry one. Naming the module lets the build emit a static import
for that module and nothing else. Purely additive — an app passing objects is unaffected.

A specifier that cannot be loaded, or whose module has no default export, fails by name with its
index. Skipping it would leave an app running with one fewer plugin than it declared and nothing
saying so.
