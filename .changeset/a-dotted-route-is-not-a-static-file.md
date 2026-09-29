---
'theokit': patch
---

A route whose last segment contains a dot is rendered, not handed to the asset handler

The Cloudflare worker owns `/` — `run_worker_first` is what stops the asset handler answering the
document — so it also receives `/robots.txt` and `/logo.png`, and rendering SSR for those would answer
a text file with HTML. The discriminator was an extension on the last segment, and that DECIDED: a dot
meant "static file".

It is a guess about paths, and it is wrong for real routes. `/users/john.doe`, `/v1.2/docs` and
`/reports/2026.q3` were each handed to a handler that does not have them, and with
`not_found_handling = "none"` that is a 404 for a page the app renders.

The extension is now a pre-filter rather than the decision: a miss falls through to SSR, so a wrong
guess costs one local binding lookup instead of the response. Keeping the pre-filter is what keeps that
lookup off every ordinary page request — `/dashboard` never touches the binding, which a
"always ask first" version would have changed.

Still uncovered, and stated rather than implied: a static file with no extension, such as a
`public/CNAME`. The pre-filter never asks for it, so it renders as a document. That is the
pre-existing behaviour and the rarer of the two directions.

The test stub for the `ASSETS` binding now answers 404 for a path it does not have, which is what the
real one does under `not_found_handling = "none"`. A stub that answered 200 for everything could not
tell a served asset from a fallthrough.
