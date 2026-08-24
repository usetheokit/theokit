---
'theokit': minor
---

A placeholder session secret no longer boots in production.

`assertProductionSecret` has always been exported, always been documented as the production guard,
and — until now — was called by nothing. `createSessionManager` and `createSessionManagerWeb` both
validated their secret through `normalizeSecrets`, which enforces a 32-character floor in every
environment and knows nothing about placeholders. The gap between the two functions was exactly the
placeholder check, so a 32-or-more character `CHANGE_ME…` sailed through into production.

The dev-time warning was in the same position. The sentence telling a developer that "the
production server will REFUSE to boot until you replace it" lived inside the uncalled function, so
the developer never saw the warning and the refusal never fired. A promise made by unreachable code
reads as a guarantee.

Both session managers now resolve their secret through one function that runs both checks. The
order is deliberate: the length floor speaks first, so a short secret keeps the message it has
always had, and only then does the production guard get its say.

**This can refuse a boot that previously succeeded** — which is the entire point, and is why it is
a minor rather than a patch. If your deployment starts refusing, the secret it is refusing is one
of:

- shorter than 32 characters, or
- matching `CHANGE_ME`, `demo-`, `demo_` or `placeholder` (case-insensitive)

Replace it with a real one — `openssl rand -hex 32` — rather than working around the refusal.
Outside production nothing is refused; you get the warning instead, which is now actually reachable.
