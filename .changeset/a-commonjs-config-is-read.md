---
"theokit": patch
---

`loadConfig` reads `theo.config.ts` in a package without `"type": "module"` on a Node that cannot strip types (below 22.18). tsx loads it as CommonJS there and the default export arrives wrapped, so the config was replaced by the defaults without a message and every command ran on `server/`, `app/` and the default port. The wrapper is now unwrapped, and a default export with a `default` key beside other keys, or a non-object default in `theo.config.<NODE_ENV>.ts`, fails with `TheoConfigError` naming the file instead of being ignored. (#1100)
