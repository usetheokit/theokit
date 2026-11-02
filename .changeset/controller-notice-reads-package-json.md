---
"theokit": patch
---

`theokit generate controller` names every package a controller build needs that the project's `package.json` does not declare: `@theokit/http` and `reflect-metadata`, plus `@swc/core` as a dev dependency. It prints the install command for the project's package manager, read from its lockfile. It used to check whether `@theokit/http` resolved, and in an npm-installed scaffold it always does because `theokit` depends on it, so the notice never appeared and `theokit build` failed on the missing `@swc/core`. (#986)
