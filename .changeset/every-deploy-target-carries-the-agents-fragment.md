---
"theokit": minor
---

Three of the six Web deploy targets carried no agents at all. `vercel`, `netlify` and `aws-lambda`
emitted an entry that never asked the agent aux dispatcher, so `GET /api/agents/<name>/approvals`
fell through to the run handler and answered `BAD_REQUEST` for want of a message — on a target the
framework advertises as supported, with no diagnostic anywhere. All six now carry the fragment.

The reason the three had been skipped did not survive re-measurement, and it is worth recording
because it is the kind of mistake that looks like evidence. The three were counted by how many
`new Request` occurrences each entry contained — vercel 2, netlify 0, aws-lambda 1 — and the
conclusion drawn was that a Web-`Request`-shaped branch could not reach them. That measures how
each entry OBTAINS a request, which is a different question from whether it has one: netlify's
handler is `(request, context)` and already receives a Web `Request`; aws-lambda already builds one
with `eventV2ToRequest(event)` for its CORS matcher; vercel already builds one and hands it to
`createWebShim`. All three had the shape the branch needs, so all three now use the ONE fragment
rather than getting a near-copy each.

Two behaviour changes come with it, named rather than left to be discovered. On `vercel` the
Node-to-Web conversion is hoisted above the agents branch, so an unmatched `POST` now has its body
drained where it did not — the safer direction, since an unconsumed Node request socket is what
holds a connection open. And on all three the build now passes the project's configured
`agentsDir`, which the option accepted and no build supplied: a project that had configured one was
silently getting the default `agents`.

Every emitted entry is now also run through the compiler as part of the suite. These adapters build
JavaScript out of template literals, and an assertion that a string contains the right words cannot
see an unbalanced brace.
