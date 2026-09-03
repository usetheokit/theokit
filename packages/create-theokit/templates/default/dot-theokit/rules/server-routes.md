---
description: Conventions for backend route handlers
globs:
  - src/server/routes/**/*.ts
---

# Route handler conventions

These apply when the conversation touches a file under `src/server/routes/`.

- A route validates its input at the boundary with Zod and trusts it afterwards. A handler that
  re-checks the same shape three layers down is describing distrust of its own validation.
- Return a typed error, never a bare `null` or `-1`. The caller cannot tell a missing value from a
  failure, and one of those is a bug worth an alert.
- Read secrets from the environment inside the handler, never at module scope — a module-level read
  runs at import time, which is before the process has decided whether it is a build or a boot.
