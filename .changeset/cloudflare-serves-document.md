---
'theokit': patch
---

The Cloudflare adapter now serves the HTML document, with the security baseline on it. With
`ssrStreaming: false` it returned 404 for every non-API request while `wrangler.toml` declared a
`[site]` bucket nothing read — so the page was missing, not merely unprotected. The config declares
an `[assets]` binding with SPA fallback and the worker returns the asset through it.

The per-target security notice also stops instructing you to configure `vercel` and `netlify`
document headers, which this build has emitted since #412's first half; it now distinguishes a
handler-served document, a platform this build configures, and a platform it owns no artifact for.
