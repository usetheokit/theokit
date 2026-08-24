---
'theokit': minor
---

Every Web deploy target now serves the security headers the app configured.

`theokit start` applied the configured baseline to every response it wrote, and none of the six
Web-standards deploy adapters applied any. A page served from Vercel, Cloudflare, Netlify, Bun,
Deno Deploy or AWS Lambda carried no Content-Security-Policy, no `X-Frame-Options`, no
`Strict-Transport-Security` and no `X-Content-Type-Options`, while the same page under
`theokit start` carried all four. Clickjacking and MIME-sniffing defences an operator had declared
existed only in development.

Each emitted entry now carries `security.headers` as a build-time literal, calls the same
`buildSecurityHeaders` the local server calls, and applies the result at one point per handler —
including the not-found branches, so a later edit cannot add a response that skips them. A header
the route set itself is never overruled, matching how the local server lets a handler win.

Two limits are stated rather than left to be found in production, and the build prints both:

- **The CSP carries no nonce**, except on Cloudflare with `ssrStreaming: true`. A nonce is minted
  per response and cannot survive a build-time literal, so only a target that renders the HTML at
  request time can put the same value on the header and on the script tag. The streamed Cloudflare
  worker does exactly that and gets a per-request nonce; everywhere else an inline `<script>` is
  refused by `script-src 'self'` — the same answer the framework already gives a prerendered route.
- **On four targets the HTML document is served by the platform's static host**, not by the handler
  these headers are attached to, so they reach `/api/*` and not the page. Configuring the
  document's headers on the platform is tracked separately.

The rate-limit half of the same deployment gap is untouched: it needs a per-runtime client address
and is not a build-time value.
