---
'@theokit/agents': patch
---

`sessionCommands<Ctx>` passes the caller's context to every handler and adds `clear`, `retry`, `usage`, `help`, `quit` (alias `exit`), `sessions`, `resume`, `fork`, `rename`, `archive`, `delete`, `goal`, `login` and `logout`; `routeCommand` and `createCommandRegistry` take `RouteOptions` (`caseInsensitive`, `stripBotSuffix`).
