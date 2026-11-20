---
'theokit': major
'create-theokit': minor
---

`vite`, `@vitejs/plugin-react`, `typescript` and `tsx` are now optional peer dependencies of `theokit`, so apps that only use `theokit/server/*` no longer install them. Apps that run the CLI must list them in `devDependencies`; `theokit dev`, `build` and `preview` exit with a message naming the missing package and the install command. `create-theokit` templates now list them. `theokit start` needs `tsx` too and names it if missing; the CLI no longer loads `tsx` at startup, only after this check.
