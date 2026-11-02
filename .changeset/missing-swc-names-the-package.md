---
"@theokit/http": patch
---

Without `@swc/core`, compiling a controller fails with an error that says every controller needs it and names it as a dev dependency to add, plus the file being compiled. It said `@swc/core` was required for parameter decorators, which a controller without `@Body`, `@Param` or `@Query` does not contain, and prescribed `pnpm add -D @swc/core` in npm and yarn projects too. (#1086)
