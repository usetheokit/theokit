---
'theokit': patch
---

`theokit build --target netlify` adds an SPA fallback to `netlify.toml` (`/*` to `/index.html`, status 200, after the `/api/*` rule and unforced), so a client-routed page opened directly or reloaded on Netlify gets the document instead of a 404. A project's own `/*` rule is left as it is. (#949)
