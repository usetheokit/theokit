---
'@theokit/agents': minor
---

`CustomCommand.frontmatter` carries the frontmatter lines, so a product can read its own keys.

The loader knows one key (`description`). A product's commands declare more, and the sets do not
agree: the closest consumer reads `model`, `agent`, `subtask` and `hints`, while Claude Code's custom
commands declare `model` and `argument-hint`. Two vocabularies already, and neither is the
framework's to adopt.

Measured cost of not carrying them: that consumer wrote a 122-line loader — same directories, same
trust gate, same precedence — because the result gave it nowhere to read its own keys from. The lines
travel now, and `frontmatterValue` (already exported) reads whichever key the caller cares about.
