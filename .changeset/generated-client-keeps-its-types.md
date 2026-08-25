---
'theokit': patch
'create-theokit': patch
---

The generated `@theo/client` produces real types instead of `any`.

Inside a `declare module` block, a relative `import type` aliased at the top and then fed to an external package's conditional type resolves to `any` — silently, with no error, which is what made it invisible. Every call through the generated client returned `any` while the app compiled and the developer believed they were using a typed client.

Route exports are now named inline as `typeof import('../server/routes/x').GET`, the form measured to survive. No aliased relative import is left in the generated output: the controller path moved to the same shape, because the alias resolved correctly in one block and to `any` in another with nothing in the file to say which.

The scaffold's `tsconfig.json` also includes `.theokit/**/*.d.ts` now. It listed `types/**/*.d.ts` and not the directory the framework writes into, so the generated client types were never loaded at all — which hid the defect above from anyone who looked.

The tests that pinned the old output matched the emitted string, down to the alias. A string assertion cannot tell a type that works from one that collapses; the new test compiles the generated file and asserts the compiler rejects a wrong assignment.
