---
'theokit': patch
---

The OpenAPI emitter writes a union of plain primitives (`z.union([z.string(), z.number()])`) as `oneOf: [{ type: 'string' }, { type: 'number' }]` again, with `nullable: true` when the union is nullable. From zod 4.6, `z.toJSONSchema` returns such a union as a type array (`type: ['string', 'number']`), which OpenAPI 3.0 does not accept, and the emitter passed it through unchanged.
