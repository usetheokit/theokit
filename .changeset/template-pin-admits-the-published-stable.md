---
'create-theokit': patch
---

**A generated app now installs the `@theokit/agents` line that is actually published.**

The template pinned `"@theokit/agents": "^10.1.0"` while npm's `latest` was `12.1.0`. A caret does
not cross a major, so every app scaffolded from it installed **10.1.0** — two majors behind, and
missing what those majors carried:

- **11.0.0** — the server's raw error text no longer reaches the browser by default. A generated app
  was still returning a tool handler's stderr verbatim to the client.
- **12.0.0** — `@theokit/agents/pty` moved to its own package, so the native build step is no longer
  pulled in.

Pin bumped to `^12.1.0`, verified end to end on a generated app: it installs `12.1.0`, and
`typecheck`, `lint`, `format:check`, `test` and `theokit build` all pass.

## Why the guard that exists did not catch it

`scripts/sync-template-pins.mjs` was written for exactly this failure (#424 — the template pinned
`^0.48.3` while the repo was at `0.49.0`). In prerelease mode it abstains from rewriting, correctly:
syncing then would pin a scaffolded app to the `next` channel, and #618 showed it also deadlocks the
release.

But the abstention rested on a premise it never checked — *"the pin it has points at the last stable
line"*. That holds only while no workspace package publishes a stable release during another's
prerelease, and `@theokit/agents` published 11.x and 12.x during `theokit`'s.

Prerelease mode now **verifies** that premise instead of asserting it: each template pin is checked
against the version npm serves on `latest`, and a pin that excludes it fails `--check`. A range the
comparison cannot read, or a registry that does not answer, is reported as *unverified* rather than
as wrong — failing a release on a network blip would be its own defect.

`caretAdmits` is exported and unit-tested (13 cases), including the `0.x` line where a caret pins the
minor — which is the shape #424 itself had.
