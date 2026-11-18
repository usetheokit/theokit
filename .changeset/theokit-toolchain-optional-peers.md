---
'theokit': major
'create-theokit': minor
---

`vite`, `@vitejs/plugin-react` and `typescript` are now optional peer dependencies of `theokit`, so apps that only use `theokit/server/*` no longer install them. Apps that run the CLI must list them in `devDependencies`; `theokit dev`, `build` and `preview` exit with a message naming the missing package and the install command. `create-theokit` templates now list them. `tsx` stays a dependency because `theokit start` loads TypeScript source.
