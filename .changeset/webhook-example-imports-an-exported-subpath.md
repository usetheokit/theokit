---
"theokit": patch
---

The `defineWebhook` example in its docblock (shown in editor tooltips) imports `defineWebhook` and `stripe` from `theokit/server/webhook`. It imported `stripe` from `theokit/server/webhook/providers`, which is not in `package.json#exports` and fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `defineWebhook` from the deprecated `theokit/server` umbrella. (#1024)
