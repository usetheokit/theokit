---
'theokit': patch
---

`theokit build --target netlify` places its `/api/*` redirect ahead of a `/*` catch-all already in the project's `netlify.toml`, and a rebuild moves one an earlier build appended after it. Netlify applies the first rule that matches, so with a project catch-all no route reached the function (#1123).
