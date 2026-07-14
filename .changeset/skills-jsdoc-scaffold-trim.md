---
"@theokit/agents": patch
"create-theokit": patch
---

DX: move the `.skills()` mechanism explanation from the scaffold into the API's JSDoc.

The `agents/chat.ts` scaffold carried a 4-line inline comment explaining *how* skills work (the `<skills>` block + the on-demand `skill_read` tool). That belongs on the API, not in the developer's first file. The explanation now lives in the `.skills()` JSDoc (discoverable on hover / cmd-click) and the scaffold keeps a one-line pointer — so a freshly scaffolded `chat.ts` reads as intent (`​.skills([dailyBriefingSkill])`) with the "how" one hover away.
