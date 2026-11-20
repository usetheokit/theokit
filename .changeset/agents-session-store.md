---
'@theokit/agents': minor
---

New subpath `@theokit/agents/control` with `createSessionStore`: named sessions that keep one agent each, run one turn at a time, bound the number kept (evicting the least recently used idle one), and support `interrupt`, `steer`, `cancelOwnedBy` and `close`.
