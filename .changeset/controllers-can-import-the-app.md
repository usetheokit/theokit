---
'theokit': minor
---

A `@Controller` can now import the app's own code. Before this it worked under `theokit dev` and failed `theokit build` with `Cannot find module '.theokit/…'` — the compiled controller resolved its relative imports from `dist`, where the app does not exist. Only package imports survived, which is why every existing test passed. Relative specifiers are now rewritten to the source files the app already runs from.
