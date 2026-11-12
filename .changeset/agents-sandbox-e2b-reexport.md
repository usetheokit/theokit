---
'@theokit/agents': patch
---

Re-export the SDK's `E2BSandbox`, `E2B_CA_BUNDLE` and their config types from `/sandbox` (SDK 5.17). The `@theokit/sdk` floor is now `^5.17.0`, because older versions do not export them and the build failed there.
