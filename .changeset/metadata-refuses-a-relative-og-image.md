---
'theokit': minor
---

`<Metadata>` refuses a relative `ogImage` in development.

Open Graph resolves `og:image` against the **crawler's** origin, not the page's, so a relative path
produces a tag that is present, well-formed and broken. It renders correctly in the browser, which
is why nobody finds out until the link has been shared — the one moment the card exists to serve.
The component's own documented example taught the broken form, and now shows an absolute URL.

The check runs in development only, and the asymmetry is deliberate rather than a compromise.
Throwing in production would turn a broken social card into a 500 on a page that otherwise renders,
trading a defect for an outage. Throwing in development puts the failure in front of the only person
who can fix it, at the moment they wrote it, and costs a production page nothing.

Protocol-relative URLs (`//cdn.example.com/og.png`) and `data:` URIs are accepted: neither has an
origin a crawler can resolve wrongly.

Migration: pass an absolute URL. If your `ogImage` is relative today, the card is already broken for
everyone but you.
