---
'theokit': patch
---

Three more places where a path was resolved twice now open one descriptor and answer both questions
through it.

`serveSpecFile` asked whether the OpenAPI spec existed and then opened it by name, so the file that
answered the first question need not be the one that answered the second — which is the `413` cap
being bypassable rather than enforced. `openSync` answers both at once: absent is `ENOENT` and keeps
its own `503`, anything else keeps its `500`, and the size is now measured on the descriptor that is
read.

`.env` loading inspected the path for the symlink transparency note and then read it by name, so the
note could describe a different file from the one whose values were loaded. The note is now produced
after the descriptor is open, and the bytes come from that descriptor.

`sendError`'s log escaping collapsed to a single exhaustive pass over both line terminators, which is
the same guarantee stated once instead of twice.

No response, no log line and no loaded value changes for a file that is not being swapped underneath
the process.
