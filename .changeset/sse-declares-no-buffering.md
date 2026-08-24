---
'theokit': patch
---

The agent SSE response tells the path not to buffer it.

It sent two headers, so any intermediary that buffers by default — nginx, a compressing reverse
proxy, a CDN edge — was free to hold an entire agent run and hand the user one block at the end. The
server streamed correctly and told nobody downstream, which breaks exactly where it is hardest to
notice: behind someone else's proxy, in production, looking correct.

`cache-control: no-cache` and `x-accel-buffering: no` now ship on every SSE response — the encoder,
the thread route and the reconnect replay, which already shared one constant.

The Vercel AI SDK, whose wire this mirrors, sends a fifth header that is deliberately not included:
`connection: keep-alive` is hop-by-hop, Node manages keep-alive itself on HTTP/1, and on HTTP/2 Node
drops it with `UnsupportedWarning: The provided connection header is not valid`. It would buy
nothing on one protocol and print a warning per response on the other.
