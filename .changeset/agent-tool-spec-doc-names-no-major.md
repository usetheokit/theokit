---
'theokit': patch
---

`DefineAgentToolSpec` no longer documents its schema as Zod 3.

The `@public` doc block ships in the published `.d.ts`, and it said `inputSchema` is "a Zod 3
schema" — while this package declares `peerDependencies: { zod: ^4.0.0 }` and `isZodObject` reads
both majors' internals deliberately (`def.type === 'object'` and `_def.typeName === 'ZodObject'`).
A consumer opening the type in an editor was told the wrong major, by the package that requires the
other one.

Naming a major in prose is what dated it. The doc now describes the shape, which is the same in
both.

Comment only; no behaviour change.
