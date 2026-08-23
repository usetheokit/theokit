---
'@theokit/agents': patch
'theokit': patch
---

Four separate defects the SAST gate was reporting, each fixed at its cause.

**A generated property key could not contain a backslash.** The typed app-client emits a route
segment that is not a plain identifier as a quoted key, escaping the quote but not the escape
character — so a segment ending in `\` produced `'trail\'`, whose trailing backslash escapes the
closing quote and swallows the rest of the emitted line. A backslash is a legal POSIX filename
character, so it reaches this code from `server/routes/`.

**An internal error could forge log entries.** `sendError` logs an `INTERNAL_ERROR` with its
message and request id, and an exception message can be built from request data. A newline inside
it reached the log verbatim, which is enough to append lines of one's own — a fabricated entry
sitting in the log looking exactly like a real one. Both values are now rendered as one line.

**Stripping TOTP padding was quadratic.** `base32Decode` removed trailing `=` with an anchored
`/=+$/`, which retries from every start position, so a long run of `=` followed by anything else
costs O(n²) — on an authentication path. The comment defending it argued the input was short
enough ("10..50 chars typical"), which is an expectation rather than a bound. A scan back from the
end is linear and needs no such argument.

**The hook-output fence escaped only the first `<`.** `fenceHookOutput` neutralises an early
fence-close by escaping its `<`, using a form of `replace` that stops at the first occurrence. The
fence contains exactly one today, so nothing was wrong — and nothing said so, which made the
correctness of a prompt-injection guard depend on a property of a string literal several lines
away. `replaceAll` removes the dependency.

Behaviour is otherwise unchanged: an identifier-safe key, a message without newlines, a normal
base32 secret and a well-formed hook output all produce exactly what they produced before.
