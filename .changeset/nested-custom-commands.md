---
'@theokit/agents': minor
---

`loadCustomCommands` reads subdirectories, so a namespaced command is no longer invisible.

The loader stopped at `!statSync(path).isFile()`, which means a command in a subdirectory was not
"unsupported" — it was invisible. No warning, no error: the file sits there and the command does not
exist.

Namespacing is not one product's idea. Claude Code reads `.claude/commands/frontend/component.md` as
a namespaced command, and the closest consumer names nested files by their relative path for the same
reason a flat directory stops scaling past a dozen commands.

The name is now the path relative to the commands root with the extension removed
(`frontend/component`). How it is rendered — `frontend:component`, `frontend/component` — stays the
product's, because the two known products already disagree.
