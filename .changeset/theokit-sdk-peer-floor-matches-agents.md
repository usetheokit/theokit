---
"theokit": patch
---

`theokit` declares `@theokit/sdk` `^5.11.0` as its optional peer, the floor its dependency `@theokit/agents` already requires. The peer read `^5.9.2`, so an app on SDK 5.9 or 5.10 satisfied it and npm installed a second SDK copy under `@theokit/agents`. An app on SDK 5.9 or 5.10 now gets a peer warning and must upgrade to 5.11.0. (B-412)
