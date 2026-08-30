---
'@theokit/http': minor
'theokit': minor
---

Two authoring surfaces stop making consumers write framework internals by hand.

**`@Public()`** (`@theokit/http`) — since #514 every controller route must declare an access
decision, so this sits on the critical path of every route an adopter writes. The route builder says
`.policy('public')`; a controller had to say `@SetMetadata('theokit:public', true)`, copying the
framework's metadata key into app source from a build-time module no entry point reaches. Measured in
the first real adopter: 8 controllers, 6 copies of that string. `PUBLIC_ROUTE_METADATA` is exported
with it, so one importable definition replaces a key that could not be changed without a coordinated
edit in every app. `SetMetadata` stays for anything custom, and this does not make controllers a
second policy engine — `.policy()` remains the richer surface.

**Plugin authoring types** (`theokit/server/define`) — `TheoPlugin`, `PluginContext`,
`PluginErrorContext` and the four hook signatures existed and were unexported, so an app writing a
plugin could not name the shape of its own subject and declared structural copies instead. Those
compile, and go on compiling after the framework's shape changes, until something fails at runtime.

**`subjectFromContext` fails loudly** — given a controller guard's `ExecutionContext` it used to
answer `null`, which is indistinguishable from "anonymous caller", so a guard written on it denied
everyone and passed the only test aimed at it. It now throws and names the alternative. An anonymous
run-context still answers `null`, and a context carrying both a subject and `getRequest` still
resolves — the absence is the trigger, not the shape.
