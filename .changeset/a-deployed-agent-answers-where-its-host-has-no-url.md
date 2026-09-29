---
'theokit': patch
---

A deployed agent answers on AWS Lambda, instead of 502

The generated agents fragment emitted the literal `baseUrl: url.origin` — an unwritten contract that
the host declares a `URL` object named `url` in the scope the fragment lands in. `vercel` and
`netlify` satisfy it; `aws-lambda` failed it twice over: its `url` is a STRING built from the event
headers, and it lives in `eventV2ToRequest` while the fragment lands in `routeRequest`.

Measured on a real Function URL: `/api/health` answered 200 while `/api/agents/chat` answered 502,
CloudWatch naming `ReferenceError: url is not defined at routeRequest (handler.mjs:45990:16)`. After
the fix, the same URL streams — `delta:"P"` then `delta:"ONG"` — in 2.16s.

The base-URL expression is now a parameter of the fragment, the way the request path already was, so
a host states what it has instead of being assumed to have it. A target whose entry does not declare
a `URL` named `url` passes its own expression; nothing changes for the two that did.
