---
'theokit': minor
---

A `@Controller` route that declares no access decision now fails `theokit build`, matching what a file route with no `.policy` already did. Declare one with `@UseGuards(...)` — on the method or the controller — or state that a route is open on purpose with `@SetMetadata('theokit:public', true)`. Before this, converting a protected file route to a controller and forgetting the guard produced a route that served unauthenticated requests, silently.
