---
'@theokit/agents': patch
---

`skill_read` in `'advertised'` mode takes its binary gate from `@theokit/sdk/skills` (`binaryOnPath`, exported since SDK 10.0.0) instead of a private copy. With an older SDK that lacks it, a skill that needs a binary is not served.
