---
'@theokit/agents': minor
---

`.skills(selection, { read: 'advertised' })` (and `defineAgent({ skillsRead: 'advertised' })`) makes `skill_read` serve every skill the `<skills>` block lists — inline skills, skills enabled by name, and skills discovered through the granted `settingSources` / `claudeCode` roots — after the trust gate. A root the gate withheld is never read. The default stays `'inline'`.
