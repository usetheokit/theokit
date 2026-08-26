---
'theokit': minor
---

A `@Controller` whose path the runtime cannot route to now fails `theokit build` instead of answering 404 forever. Controller routes are served from a fall-through that only runs for URLs under `/api/`, so `@Controller('probe')` compiled, emitted, and never responded. The build now names the controller, the path it declared, and the path to write instead.
