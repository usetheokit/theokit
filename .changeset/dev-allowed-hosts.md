---
'theokit': minor
---

`theo.config.ts` can now allow the hostnames the dev server answers for: `allowedHosts`.

A theokit app in dev refused every request whose `Host` was not loopback, and nothing in the config
could allow another one — which made it impossible to put the dev server behind a tunnel or a
reverse proxy. That is the only practical way to develop against a webhook platform, since the
platform has to reach the machine, and this framework ships signature validators for five of them.

Vite's own error message names the fix and the fix was unreachable: a scaffolded app has no
`vite.config.ts` — `theokit dev` owns the Vite server. `host()` never answered it either, being the
bind ADDRESS: the request is refused by hostname, after the connection is accepted.

    export default config().allowedHosts(['.trycloudflare.com']).build()

Vite's matching rules apply rather than globs — a leading dot covers the domain and its subdomains,
anything else compares literally. `true` disables the check, for a tunnel that mints a fresh
hostname per run; it also removes the DNS-rebinding protection the check provides, so prefer the
list whenever the hostname is knowable. Dev-server only: `theokit start` has no such check.
