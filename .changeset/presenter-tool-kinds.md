---
'@theokit/presenter': minor
---

Add `TOOL_KINDS` and `toolKindOf`: one exact-match table of known tool names (the TUI's measured list plus the SDK builtins `shell`, `memory_search`, `memory_get`) giving each tool's kind and target input keys. The `@theokit/sdk` peer range is now `^5.17.0`, the first release that exports `BuiltinToolName`.
