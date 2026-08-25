---
'theokit': minor
---

A route whose name contains a hyphen is reachable through the generated client. It was not.

The generator camelCased the segment — `agents-config` became `client.agentsConfig` — while the runtime Proxy builds the URL from the key it is handed and knows nothing of the transformation. So the call compiled, requested `/api/agentsConfig`, and the route served at `/api/agents-config` answered 404. Kebab-case file names are the scaffold's own convention, so the trap appeared on the first route with two words in its name.

Segments are kept literal now: `client['agents-config'].get()`. Bracket access for a hyphenated segment is the honest cost of a client that mirrors its URLs, and the machinery was already there for segments that cannot be identifiers at all.

Translating back inside the Proxy would have kept the prettier key at the cost of a second source of truth for every segment name — and a generated client is worth more as a faithful mirror.

**To upgrade:** a call on a hyphenated route becomes bracket access. Every such call is currently answering 404, so nothing that works today changes.
