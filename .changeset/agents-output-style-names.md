---
'@theokit/agents': minor
---

`loadOutputStyle` now also matches a style by its frontmatter `name` (a file-name match wins within a directory; two files claiming one name throw `OutputStyleError`), and the new `applyOutputStyle(base, style)` composes a style with a base prompt.
