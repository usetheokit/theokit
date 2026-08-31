# Migration guide

> **Where the agent surface stands today.** This page is the v1.0 cut, when the agent decorators
> were removed in favour of capabilities. `applyCapabilities` is still exported and still works, but
> the surface you should be writing NEW agents against is the builder chain —
> `AgentBuilder.create().input(…).model(…).tool(…).build()` — which carries compile-time guards the
> capability array cannot. Migrating off decorators? Follow this guide, then read the builder in the
> [README](README.md). Every breaking change since is recorded in [`CHANGELOG.md`](CHANGELOG.md)
> against the version that carried it, and the ones that need you to change code get a section
> here.

## `theokit` — every route file declares who may call it

**Breaking**, for every application with routes under `server/routes/`. The route scanner refuses a
file whose HTTP export declares no `policy`, so `theo build`, `theo start`, `theo dev`, `theo routes`
and every deployment adapter fail until each route says something. Nothing changes for a
`RouteConfig` you build in memory and hand to `executeWebRequest` or `callProcedure` directly — that
value never passes a scanner.

### What changed

`RouteConfig.policy` shipped in theokit 0.49.0 and was optional. Optional meant a route that nobody
had thought about was indistinguishable from a route deliberately left open: both had no policy, and
both were served to anyone. ADR 0001 calls that the fail-open-by-omission class, and closes it by
making the absence a build error rather than a silent default.

`'public'` is still an answer. It is just an answer somebody has to write down, which is what makes
"how much of this app is open" a number you can `grep` for.

```diff
  import { route } from 'theokit/server'

  export const GET = route()
+   .policy('public')
    .handler(() => ({ status: 'ok' }))
    .build()
```

The builder gained `.policy()` in this release; `defineRoute({ policy, handler })` takes the same
value.

### What you need to do

| Your situation | Action |
|---|---|
| A route serves data anyone may read (health, version, public feed) | `.policy('public')` |
| A route reads or writes data belonging to a user | `.policy(({ subject, params }) => requireOwner(subject, ownerOf(params.id)))` |
| A route needs any authenticated caller, without per-record ownership | `.policy(({ subject }) => subject !== null)` |
| You export a bare function (`export function GET() {}`) | Wrap it: `route().policy(...).handler(fn).build()`. A bare function has nowhere to put a policy |
| You re-export a route (`export { GET } from './shared'`) | Declare the policy in the file the scanner reads, or import the config and re-declare it. The scanner does not follow module specifiers |
| You call `executeWebRequest` / `callProcedure` with a config you built | Nothing. The gate is on scanned files |

`requireOwner` is exported from `theokit/server` and answers "may this subject touch this record"
once, so each route does not answer it again.

### How the failure reads

```
Route policy not declared: every route says who may call it (ADR 0001).

  File:    /app/server/routes/posts/[id].ts
  Route:   /api/posts/:id
  Missing: DELETE, GET
  ...
```

The file, the URL it serves, and the methods that are silent. Fix them one file at a time; the
scanner reports the first file it reaches, so the loop is: run `theo routes`, fix, repeat.

### Why not flip it at runtime instead

Making an undeclared policy deny at request time would have turned every existing route in every
consumer into a 403 with no build step in between, and the error would have arrived one request at a
time in production. The scanner already refuses a dotted route basename and a collision with the
reserved batch path by name, before anything serves traffic. This is the same gate, for a bigger
class of mistake.

## `@theokit/http` v2 — an undeclared route is refused, not served

**Breaking**, for every application serving `@Controller` classes or auto-wired agent routes.
A route that declares no access decision now answers **403** instead of being served. Nothing
changes for a route that already declares one, which is every route in an application that passes
`theokit build` today.

### What changed

`@theokit/http@1.2.0` made absence representable: `guards: []` had meant both *"open on purpose"*
and *"nobody said"*, and the dispatcher, unable to tell them apart, took the permissive reading. It
shipped `undeclaredRoutes`, defaulting to `'warn'` — the request was still served, with a line in
the log promising a 403 "in the next major".

This is that major, and it does two things the warn release did not:

1. **The default is `'deny'`.** A safe default an app has to switch on is not a safe default: the
   population that never reads the warning is the population the gate exists for.
2. **Every dispatcher enforces it.** The check lived in `TheoApp` alone, while `@theokit/http` ships
   three dispatchers over the same route metadata — and the framework's own controller dispatch
   (`theokit dev`, `theokit start`) reuses `createDecoratorHandler`, which had no check at all. The
   decision is now computed once, on the metadata walk, so all three answer identically.

A build gate has refused undeclared **controller** routes since theokit 0.60.0. That gate is a
property of the pipeline, not of the system: `theokit dev` never runs it, and `@theokit/http` is
published on its own. Least privilege now holds at dispatch, with the build gate as the earlier,
friendlier failure rather than the only one.

Agent routes were the surface with neither. They are auto-wired — the app never wrote them, so there
is no file for a reviewer to read — and they are matched *before* static files, controllers and file
routes.

### What you need to do

| Your situation | Action |
|---|---|
| A controller route anyone may call (health, version, OAuth callback) | `@Public()` on the method, or on the class to cover every route under it |
| A controller route behind authentication | `@UseGuards(AuthGuard)`, likewise on either |
| Every route in the controller needs any signed-in caller | `@UseGuards(Authenticated(sessions))` — from `theokit/server/auth`, so you no longer write that guard |
| An agent entry that anyone may call | `access: 'public'` on the entry |
| An agent entry behind authentication | `guards: [YourGuard]` on the entry |
| You wrote `@UseGuards()` with no arguments | It declares nobody. Give it a guard, or use `@Public()` — both gates refuse the empty form now |
| You need time to migrate | `undeclaredRoutes: 'warn'` on `TheoApp.create` / `createDecoratorHandler` / `httpDecoratorsPlugin` restores the old behaviour, with one warning per route |

```diff
- import { Controller, Get } from '@theokit/http'
+ import { Controller, Get, Public } from '@theokit/http'

+ @Public()
  @Controller('api/health')
  export class HealthController {
    @Get()
    check() {
      return { status: 'ok' }
    }
  }
```

`@Public()` does not disable guards. It answers *who may call this route*; a guard attached to a
public route still runs, which is what lets a route be open and still rate-limited or traced.

### The guard you no longer write

`theokit/server/auth` exports `Authenticated(sessions)` — "any signed-in caller", the controller
equivalent of `.policy(({ subject }) => subject !== null)`:

```typescript
import { createSessionManagerWeb, Authenticated } from 'theokit/server/auth'

const sessions = createSessionManagerWeb<{ userId: string }>({ secret: process.env.SESSION_SECRET! })

@Controller('api/tasks')
@UseGuards(Authenticated(sessions))
export class TasksController { … }
```

It exists because the hand-written version has a failure mode worth naming: reading the subject off
the guard's `ExecutionContext` (`subjectFromContext(context)`) returns nothing, because that context
carries `getRequest`, `getUrl`, `getClass` and `getMethodName` and no subject. A guard built that way
**denies everyone**, and passes the test written for it — that test asserts an unauthenticated
request is refused. `subjectFromContext` now throws on that shape instead of answering `null`.

`Authenticated` answers "is anyone there", never "may THIS subject touch THIS record". The second
question is `requireOwner` from `theokit/server/define`.

### How the failure reads

```
403 Forbidden
Controller route /api/tasks declares no access decision, so it is refused. Attach a guard, or say
it is open on purpose (`@Public()`). `undeclaredRoutes: 'warn'` serves it with a warning while you
migrate.
```

The route, both remedies, and the escape — so the fix does not require finding the source of the
framework.

## `theokit` — every agent file declares who may run it

**Breaking**, for every application with a file under `agents/`. The agent scanner refuses a file
that declares no `policy`, so `theo build`, `theo start` and `theo dev` fail until each agent says
something. Nothing changes for an agent module you build in memory and hand to `mountAgent`
directly — that value never passes a scanner.

### What changed

The agent endpoints — the run, the thread routes, the pending-approval listing, the approve route
and MCP — are dispatched before route matching, so no `route()`, no `server/middleware/` and no
`server/context.ts` ever saw those URLs. They had no owner check anywhere on the path, and they
resume the conversation the **caller** names. Whoever holds a conversation id could read and
continue that conversation.

One declaration per agent covers all of its endpoints, because they all reach the same conversation
and the same paused tools.

```diff
  import { AgentBuilder } from '@theokit/agents'

+ export const policy = 'public'
+
  export default AgentBuilder.create()
    .model('openai/gpt-4o-mini')
    .build()
```

`'public'` is an answer, and for an app with no login it is the honest one — it says that anyone
holding a session id may read and continue that conversation, which is a capability model. What it
stops being is invisible.

For an app that has users, the check is the same primitive routes use:

```ts
import { requireOwner } from 'theokit/server/define'

//  subject  <- what server/context.ts put on ctx.subject
//  params   <- { agent, endpoint, sessionId?, approvalId? }
//  body     <- the parsed chat body, on the endpoints that carry one
export const policy = ({ subject, params }) =>
  requireOwner(subject, ownerOfConversation(params.sessionId))
```

`params.endpoint` is one of `'run' | 'thread-message' | 'thread-stream' | 'approvals' | 'approve' |
'mcp'`, so a single declaration can answer them differently.

### Where the identity comes from

`ctx.subject`, produced by your `server/context.ts` — the same seam every `route()` already reads.
The agent branches now build that context too. An app with no `context.ts` resolves no subject, so a
policy calling `requireOwner` refuses everyone; that is the correct direction for missing wiring, and
it fails on the first request rather than quietly admitting.

### What this does NOT decide

Whether a pending **approval** belongs to the caller. The approval ledger keys by a bare id and
records no owner, so the strongest question available is "may this subject touch this agent's
approvals". An authenticated user can still settle another user's approval on an agent both are
admitted to. `params.approvalId` is passed to the policy so an application holding its own owner map
can answer more.

### Why not flip it at runtime instead

There is no safe runtime default. Refusing every caller-supplied session id would break multi-turn
chat, which is the base case; admitting them is the defect. So the question moves to a build error
that names the file, exactly as the route gate above does.

## `theokit` — `executeWebRequest` enforces CSRF unless you turn it off

**Breaking**, for anyone calling `executeWebRequest` from `theokit/server` directly. Routes served
by `theo dev` or `theo start` go through `executeRoute`, whose CSRF gate has defaulted to strict all
along, and are unaffected.

### What changed

`ExecuteWebRequestOptions.csrfMode` had no default. Both of the executor's gates compared the value
against `'strict'`, so omitting the option meant no CSRF check ran on POST, PUT, PATCH or DELETE.

Omitting it now enforces. `'off'` is the only value that disables the gate.

```diff
- // no csrfMode → no CSRF check
- await executeWebRequest(request, routeModule)
+ // no csrfMode → gate enforced
+ await executeWebRequest(request, routeModule)
+
+ // opt out explicitly, only if you have another defense
+ await executeWebRequest(request, routeModule, { csrfMode: 'off' })
```

### What you need to do

| Your situation | Action |
|---|---|
| You already pass `csrfMode: 'strict'` | Nothing. |
| Your callers are browsers using the generated action client | Nothing — the client already sends `X-Theo-Action: 1`. |
| A route legitimately receives third-party POSTs (Stripe or GitHub webhook, OAuth callback) | Declare `csrf: false` on that route's `defineRoute` config. The Web executor honours it now; it previously ignored it. |
| Your application has another defense entirely (no session cookie, bearer-only auth) | Pass `csrfMode: 'off'` explicitly. |
| A request now returns `403 FORBIDDEN` with `CSRF check failed: Missing X-Theo-Action header` | Send `X-Theo-Action: 1` on state-changing requests, or opt the route out per the row above. |

### Why it is worth the break

The option existed, the safe value existed, and the default was the unsafe one — so the check ran
only for a caller who already knew to ask. This executor is the boundary the Cloudflare, Bun and
Deno adapters are built on, and each of those is a caller that would have had to remember.

It has no production caller in this repository today, so this closes a future boundary rather than
a live exposure. That is the honest size of it.

## `@theokit/agents` v1.0 — agent decorators removed (M53)

**Breaking.** The **agent** decorators were removed. Authoring an agent is now composing
**capabilities** — values you pass, not metadata a class carries.

The `@theokit/http` **controller** decorators (`@Controller`, `@Get`, `@Post`, `@UseGuards`, …) are
**untouched**. This migration is only about the agent surface.

### Why

The decorator surface cost `reflect-metadata` (a **required** peer dependency),
`experimentalDecorators` + `emitDecoratorMetadata` in every consumer's tsconfig, and a metadata walk
that had to be kept in sync with the compiler. What it bought — declaring an agent's config next to
its class — capabilities give without any of that, plus three things decorators could not:

| | decorator | capability |
|---|---|---|
| Build config | needs `reflect-metadata` + `experimentalDecorators` | none |
| Conflicting declarations | silent — last write wins | **typed error** (`CapabilityConflictError`) |
| Who set what | opaque metadata | `draft.provenance` says which capability contributed each field |
| Authoring from a config **file** | impossible (needs a class) | `CapabilityRegistry` resolves name → capability |

### The 30-second version

```diff
- @Agent({ model: 'openai/gpt-5.4', systemPrompt: 'You are helpful.' })
- @Skills(['code-review'])
- export class SupportAgent {
-   @MainLoop({ strategy: 'react', maxIterations: 5 })
-   async run() {}
- }
+ export const supportAgent = applyCapabilities([
+   new ModelCapability('openai/gpt-5.4'),
+   new AgentConfigCapability({ systemPrompt: 'You are helpful.', maxIterations: 5 }),
+   skills(['code-review']),
+ ])
```

Then run it with `AgentRunner.fromSpec({ name: 'support', compiled: supportAgent, strategy: 'react' })`.

---

## Decorator → capability map

Every removed decorator, and what replaces it. Import everything from `@theokit/agents`.

### Group A — replaced by a capability

| Removed decorator | Replacement | Notes |
|---|---|---|
| `@Agent({ model })` | `new ModelCapability(id, reasoningEffort?)` | `name`/`route` are HTTP concerns — see § Mounting |
| `@Agent({ systemPrompt, parseThinkTags, stripToolDialect, recoverLeakedToolCalls, stream, maxIterations, timeoutMs })` | `new AgentConfigCapability({ … })` | same field names |
| `@MainLoop({ maxIterations, timeoutMs })` | `new MainLoopCapability({ … })` | **wins** over `AgentConfigCapability`, as before |
| `@MainLoop({ strategy })` | `AgentRunner.fromSpec({ strategy })` | strategy is a runner concern, not a compiled field |
| `@Tool` + `@Toolbox` | `new ToolboxCapability(instance, { namespace })` | see § Toolboxes |
| `@HumanInTheLoop` | `hitl` on the tool declaration | see § Toolboxes |
| `@Skills([...])` | `skills([...])` | accepts `string \| InlineSkill` |
| `@Skills({ include, autoDiscover })` | `skillsOptions({ include, autoDiscover })` | the options form |
| `@Memory({...})` | `memory({...})` | |
| `@ContextWindow({...})` | `contextWindow({...})` | |
| `@ProjectContext({...})` | `projectContext({...})` | |
| `@MCP({...})` | `mcpServers({...})` | |
| `@Guardrails([...])` | `guardrails([...])` | |
| `@Checkpoint({...})` | `checkpoint({...})` | keeps the "non-filesystem storage does not resume" warning |
| `@SubAgents([...])` | `subAgents({ name: spec })` | takes child specs directly |

### Group B — moved to a different channel (not a capability)

These never reached the compiled agent options, so a capability would be the wrong home.

| Removed decorator | Where it went |
|---|---|
| `@Compaction(name, opts)` | `AgentRunner.fromSpec({ compaction: { name, keepTokens } })` or `.compaction(name, opts)` — the builder override already outranked the decorator |
| `@MainLoop({ strategy })` | `AgentRunner.fromSpec({ strategy })` (see Group A) |
| `@Gateway({...})` | declare it on the manifest entry — it only ever fed `generateAgentManifest` |
| `@Trace` / `@Audit` | `trace: true` / `audit: true` on the tool declaration (manifest-only flags) |
| `@RequiresApproval` | `approval` on the tool declaration |
| `@Mixin(Toolbox)` | pass another `ToolboxCapability` — composition replaces metadata-based mixing |

### Group C — REMOVED with no replacement (they did nothing)

Each of these wrote metadata **no production code ever read**. Deleting them removes no behavior.
If you used one, deleting the line is the whole migration.

`@Artifact` · `@Hook` · `@Observable` · `@Sandbox` · `@EditFormat` · `@Model` ·
`@RequiresCapability` · `@Policy` · `@Budget`

Two deserve a callout, because the name implied otherwise:

- **`@Model` did not set the model.** `@Agent({ model })` did. `@Model` wrote an anonymous symbol
  nobody read. Use `ModelCapability`.
- **`@Sandbox` did not sandbox anything.** Its metadata was unread and its exported
  `isPathAllowed`/`isCommandAllowed` helpers had no production caller. A real sandbox is
  `@theokit/sdk`'s, reached through `Agent.create`.
- **`@Budget` only emitted a warning saying it had no effect.** The warning went with it.

---

## Toolboxes

A toolbox class now declares its tools as **data** and keeps handlers as ordinary methods — so it
can still hold state and receive injected dependencies:

```diff
- @Toolbox({ namespace: 'ops' })
- class OpsTools {
-   @Tool({ name: 'deploy', description: 'Deploy', input: z.object({ env: z.string() }) })
-   @HumanInTheLoop({ question: 'Confirm deploy?' })
-   async deploy({ env }: { env: string }) { return doDeploy(env) }
- }
+ class OpsTools {
+   static readonly tools: ToolDeclaration[] = [
+     {
+       name: 'deploy',
+       description: 'Deploy',
+       input: z.object({ env: z.string() }),
+       method: 'deploy',
+       hitl: { question: 'Confirm deploy?' },
+     },
+   ]
+   constructor(private readonly k8s: K8sClient) {}
+   async deploy({ env }: { env: string }): Promise<string> { return this.k8s.deploy(env) }
+ }
```

Compose it with `new ToolboxCapability(new OpsTools(k8s), { namespace: 'ops' })`. The tool is still
named `ops_deploy`, the handler is still bound to the instance, and the `hitl` gate still lands in
the same `compiled.hitl` map.

**One improvement:** a typo in `method` now fails at **authoring** time (`ConfigurationError`),
instead of when the model finally decides to call the tool.

> **Namespace separator changed (theokit#145).** A namespaced tool is now `ns_tool`, not `ns.tool`.
> The dot is outside the charset `@theokit/sdk` accepts (`/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`), so the
> old form was rejected by `Agent.create` — a namespaced toolbox never actually worked against a
> real provider. If you hardcoded a gate key or an allow-list entry as `ns.tool`, update it to
> `ns_tool`. A namespace that cannot produce a valid name now fails at authoring time.

## Mounting (name / route)

`@Agent({ name, route })` carried two HTTP concerns that are not agent configuration. They now go on
the mount entry:

```diff
- @Agent({ name: 'support', route: '/api/agents/support', model: 'openai/gpt-5.4' })
  const app = await TheoApp.create({
    controllers: [...],
-   agents: [SupportAgent],
+   agents: [{ name: 'support', route: '/api/agents/support', compiled: supportAgent }],
  })
```

`agentsPlugin({ agents })` takes the same entry shape.

## Authoring from a config file (new)

Not a migration — a capability the decorators could not offer. A registry resolves names to
capabilities, so an agent can be declared in `.theokit/agent.json` instead of in code:

```typescript
const registry = new CapabilityRegistry()
  .register('model', (id) => new ModelCapability(id as string))
  .register('skills', (names) => skills(names as string[]))

const compiled = applyCapabilities(
  config.capabilities.map((c) => registry.resolve(c.name, c.arg)),
)
```

Wrong-typed values from the file fail at the boundary with a typed `ConfigurationError` — the
message names the offending **type**, never its content (a config file may carry tokens).

## Build config you can now delete

```diff
  // tsconfig.json
  "compilerOptions": {
-   "experimentalDecorators": true,
-   "emitDecoratorMetadata": true,
  }
```

```diff
  // package.json
  "dependencies": {
-   "reflect-metadata": "^0.2.0",
  }
```

```diff
  // your entry file
- import 'reflect-metadata'
```

> Keep all three **if** you also use the `@theokit/http` controller decorators — those still need
> them. This removal applies to the agent surface only.

## Codemod

There is **no automated codemod**, and that is deliberate rather than an omission: the mechanical
half (rename `@X` → `x()`) is the easy part, while the two decisions that actually matter cannot be
inferred from the source —

1. **Where the toolbox's dependencies come from.** The decorator form had no constructor injection,
   so a codemod has no way to know what `new OpsTools(???)` should receive.
2. **Which decorators were Group C.** Those lines are deleted, not translated — a codemod that
   "migrated" them would invent a capability for something that never did anything.

The map above is ordered so you can work top-down through a file. If your codebase is large enough
that a project-specific codemod pays for itself, the Group A table is a direct rename table; Groups
B and C need a human.
