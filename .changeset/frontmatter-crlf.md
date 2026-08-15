---
'@theokit/agents': patch
---

Frontmatter is read on CRLF files instead of being reported as never closing.

`splitFrontmatter` split on `'\n'`, so on a CRLF checkout the closing line is `'---\r'`, which never
equalled the fence: a perfectly valid file returned "frontmatter never closes" and was skipped. On
Windows that is every instruction file with frontmatter, silently, with a warning blaming a missing
`---` that is sitting right there.

The trap ran one level deeper. `.` does not match `\r` and `$` does not match before it, so the
list-item pattern behind `paths:` failed on `'  - src/**\r'`. Fixing only the fence would have
turned "the file is skipped" into "the file is read and silently unscoped" — worse, because a rule
that applies everywhere looks like it works.

Line endings are now normalised at the boundary, and the closing fence is compared trimmed like the
opening one already was — an asymmetry that let a file open a frontmatter block it could never close.
