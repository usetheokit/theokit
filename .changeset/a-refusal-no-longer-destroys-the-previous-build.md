---
'theokit': patch
---

A build that refuses no longer empties the output first.

`cleanOutDir` ran at the top of `buildCommand`, above even the check that the target exists. Measured on
a real project: a successful build leaves 302 files in `.theokit/client/assets`, and

    theokit build --target not-a-target
    ✗ Invalid build target "not-a-target". Available targets: node, vercel, cloudflare, …

left 0. One mistyped character cost a working build, and nothing in the error said anything was destroyed.

The same order defeated two refusals that are decidable from the target and the config alone: the
`aws-lambda` streaming refusal, and `assertRateLimitEnforceable` — whose own comment claimed the
combination was "refused by name, BEFORE the build writes anything" while being reached a hundred lines
after the clean. Three instances of one cause, and the cause was the order rather than any of the checks.

Both messages survive unchanged. The `aws-lambda` refusal still explains that the Lambda v2 result object
carries the body as a string and that `awslambda.streamifyResponse` plus a Function URL in
RESPONSE_STREAM invoke mode would be needed — the adapter declares that detail now, so the check could
move without the guidance moving with it. The list of streaming alternatives is derived from the registry
rather than written into the sentence.
