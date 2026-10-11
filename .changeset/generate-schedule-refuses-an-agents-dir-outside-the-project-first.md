---
"theokit": patch
---

`theokit generate schedule` refuses an `agentsDir` outside the project as path traversal even when that directory holds no `chat` agent. The generator looked for the chat agent before it checked containment, so such a project was told `No "chat" agent in <directory outside the project>` and asked to create the agent there. It now answers `Path traversal denied: ... is outside the project root ...` and writes nothing. (B-411)
