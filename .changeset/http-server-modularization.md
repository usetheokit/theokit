---
'@theokit/http': patch
---

Move `createNodeServer`, `BindError` and their types into their own module, separate from the Node runtime adapter. The public `@theokit/http/runtime/node` exports are unchanged.
