---
'create-theokit': patch
---

Scaffolded files are written with `O_NOFOLLOW`, so a symlink planted at a predictable name in the
target directory no longer redirects the write. Creating and overwriting behave exactly as before.
