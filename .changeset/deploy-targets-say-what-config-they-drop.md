---
'theokit': minor
---

A build now names every configuration key the chosen deploy target validates and then never applies.

`theo.config.ts` parses `rateLimit`, `security.cors`, `security.csrf`, `security.disallowed` and
`serialization` for every target, and the six Web-standards adapters build `executeRoute`'s context
from a subset of its fields — so on a deployed app the rest fall back to hard-coded defaults, and
`security.cors` reaches no production target at all. An operator who declared a rate limit got none,
and nothing anywhere said so.

Each adapter now declares which of those concerns the handler it emits actually applies, following
the contract `streamsResponses` already established: omitted means none, on purpose, so a new
adapter has to state what it honours rather than inherit a silent yes. An adapter that emits no
request handler answers `runtime-not-emitted-here`, which is a different fact from "drops
everything" and is reported as neither.

`theokit build` prints the difference before it builds, naming the keys as they appear in the config
file and what to do about each. It warns rather than refuses: refusing would break every deployment
that declares a rate limit today, while the fix those keys are waiting for is not a build away.

Nothing is dropped when the declared value equals what an unwired target does anyway —
`csrf: 'strict'` and `serialization: 'json'` are honoured by coincidence, and a warning over an
identical outcome only teaches operators to skip the block.
