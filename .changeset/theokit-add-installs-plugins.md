---
"theokit": patch
---

`theokit add` installs the first-party plugins, by scoped name (`theokit add @theokit/plugin-db-drizzle`) or short name (`theokit add plugin-db-drizzle`): canvas, copilot, db-drizzle, email, forms, payments, realtime and voice. The help text and the Plugins page documented `theokit add @theokit/plugin-payments`, but the whitelist held only the five bundled build targets and the name check refused every scoped name. Other scopes are still refused. (#1076)
