---
"theokit": minor
---

Add a `response` Zod slot to `RouteConfig` (runtime output validation in both the Node and Web runtimes) and a `params` schema to `defineAgentEndpoint` (typed, validated path params). The Web runtime now honors `config.status` for plain-object returns, matching the Node runtime.
