---
'theokit': patch
---

`theokit build --target bun` prints the command that starts its output, and the emitted entry names that command when `NODE_ENV` is not `production` (#936). The `services.json` v1 warning prints only for `--target theo-cloud` and no longer names a sunset version that passed long ago (#935).
