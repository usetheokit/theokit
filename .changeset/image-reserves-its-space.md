---
'theokit': minor
---

`<Image>` now reserves its space, and refuses a `srcSet` that cannot be resolved. **Breaking for callers who omitted dimensions.**

The component's own documentation said "width/height for CLS prevention" and enforced neither: both
were forwarded when present and absent when not, so the shift the comment named was the default
behaviour. `srcSet` was accepted without `sizes` the same way, and a browser given no `sizes`
resolves the candidates against `100vw` — it downloads an image picked for the wrong width, usually
the largest, which is the opposite of what adding a `srcSet` was meant to achieve.

`width` and `height` are now required, and `srcSet` and `sizes` travel together or not at all. Both
are expressed in the type, so a TypeScript caller finds out at build time with the prop named, at no
runtime cost. A JavaScript caller gets a thrown error naming the prop and the consequence rather
than a page that shifts.

Migration: pass the intrinsic pixel dimensions. CSS may still resize the image — the attributes give
the browser the aspect ratio to reserve, they do not fix the rendered size. If a `srcSet` was
declared without `sizes`, add `sizes`; the candidates were being resolved against `100vw` until now,
so the picked image is likely to change, and that is the fix rather than a regression.

Still explicitly out of scope, and now stated in the component's documentation instead of being left
to inference: nothing here resizes or re-encodes an image, and the framework ships no fonts module.
