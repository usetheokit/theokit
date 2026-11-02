---
'theokit': patch
---

The entries the `vercel`, `netlify`, `cloudflare`, `bun`, `deno-deploy` and `aws-lambda` targets emit answer `GET /__theo/health` and `GET /__theo/ready` like `theokit start`, and the Vercel and Netlify routing sends both paths to the function. Both used to answer `200 text/html` from the SPA. A `ready` probe in `theo.config.ts` cannot be carried to these targets, so `theokit build` names it as not applied and `/__theo/ready` answers 503 there instead of claiming ready (#1097).
