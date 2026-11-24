---
'@theokit/host': patch
---

The browser proxy of `@theokit/host/browser` hands its server one `tools/call` at a time (a cancelled call does not hold the ones behind it), and answers a snapshot link it cannot read, one that is empty or one that leaves the output directory with a line saying so instead of leaving the link.
