---
'theokit': patch
---

`theokit build --target deno-deploy` copies the client build to `theokit-deploy/client`, and the emitted `theokit-deploy/server.ts` serves it: the file when it exists, `index.html` for a client route, a 404 for a missing asset, with `..` refused. A dynamic Deno Deploy app answered 404 for `/` and every page, because the entry left them to a static handler the platform does not have for that app type, and the upload skips `.theokit/` through the scaffold's `.gitignore`. The document now also carries the security headers. (#951)
