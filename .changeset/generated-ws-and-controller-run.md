---
"theokit": patch
---

`theokit generate ws` writes a handler built with `websocket()` from `theokit/server/define`. The old file imported `defineWebSocket` from `theokit/server`, which no public entry point exports, so it failed to load and the socket closed on connect. `theokit generate controller` writes a controller that `theokit build` accepts: `@Controller()` serves it at `/api/<name>`, and a generated guard refuses every request with 403 until you replace it with your own guard or `@Public()`. The old `@Controller('<name>')` with no access decision failed the build twice, once for a prefix the runtime never routes to and once for an undeclared access decision. When the project does not depend on `@theokit/http`, which the scaffold does not install, `generate controller` says so and prints the install command. The route, action, agent, toolbox and sandbox templates import from `theokit/server/define` instead of the deprecated `theokit/server` entry. (#986)
