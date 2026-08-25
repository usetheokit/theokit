---
'create-theokit': patch
---

A freshly scaffolded app passes its own `lint` and `format:check` before anyone edits a line.

It did not. After the first `pnpm build`, `pnpm lint` reported around 1800 findings in `.theokit/` — generated `.d.ts` nobody wrote — because the template's ESLint config ignored `dist/` and `node_modules/` and not the framework's own output. `pnpm format:check` failed on the lockfile and on eleven markdown files the template ships, because the template carried no `.prettierignore` at all.

Neither is a broken build. Both are worse in a quieter way: a developer who adds a real error of their own cannot find it in the noise, and a gate nobody can act on stops being read.

The template now ships a `.prettierignore`, its ESLint config ignores `.theokit/`, and its markdown is formatted to the config it hands the app.
