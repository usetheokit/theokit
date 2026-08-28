# Changelog

## 1.1.2

### Patch Changes

- 420ee70: A controller can read the raw request body again.

  `resolveBody` consumed the request to populate `@Body`, unconditionally for POST, PUT and PATCH, and swallowed the failure when the payload was not JSON. The read still happened, so a handler taking `@Req()` received a request with `bodyUsed: true` and every later read threw `Body is unusable`.

  That made `multipart/form-data` uploads and any signature-covered payload unreachable from a controller: the content-type and boundary arrived intact and the body was gone, while `@Body()` resolved to `undefined` because the JSON parse that drained it had failed.

  It now reads a `clone()`. The JSON path is unchanged.

## 1.1.1

### Patch Changes

- d222546: Both static-file servers now refuse to serve a file that lives outside the directory they were
  configured to serve, and each of them reads the file it checked rather than re-resolving the path.

  The traversal guards were operating on the path _string_ while the read operated on the
  _filesystem_, and a symlink is exactly the case where those two disagree. `serveStaticFile` resolved
  to absolute and compared the result against `clientDir`; `createStaticHandler` rejected `..` and `//`
  segments in the request pathname. Neither touches the disk, so an entry inside the served directory
  that pointed somewhere else passed both checks and the server returned the target's contents — any
  file the server process could open, to an unauthenticated `GET`. Serving a directory that also
  receives uploads, or unpacking an archive that carries a symlink, is enough to put one there.

  Containment is now decided by `realpath`, which asks the filesystem the question the string check
  cannot answer. Symlinks are not banned: one whose target stays inside the served tree is ordinary and
  is still served. Leaving is what is refused, and it is refused as "not here" rather than `403`, so
  the response does not confirm what exists outside. A URL that walks out with `..` still gets its
  `403`.

  The same lines carried a second defect. Each server resolved the path more than once — check the
  existence, stat the type or the size, then read the bytes — so what was checked was not necessarily
  what was served. Each now opens one descriptor and does both through it. Where a size _limit_ was
  enforced this was the limit being bypassable rather than enforced: the custom error pages
  (`MAX_ERROR_HTML_BYTES`) and the OpenAPI spec endpoint (`MAX_SPEC_BYTES`) both measured one file and
  could read another. `@theokit/http` additionally reported `content-length` from a separately sampled
  `stat.size` while the body came from its own read, so a file that changed size between the two
  produced a response whose declared length disagreed with its body; the length now comes from the
  bytes that were actually read.

  A path that stays inside its root behaves exactly as before — same status, same headers, same bytes.

## 1.1.0

### Minor Changes

- Removida a `peerDependency` em `@theokit/agents`. Ela invertia a direção do grafo (`agents`
  depende de `http`, nunca o contrário) e sua faixa, `>=0.47.0`, nomeava a linha de versão de outro
  pacote — nunca foi uma declaração de compatibilidade. Na prática, arrastava uma cópia antiga de
  `@theokit/agents` para dentro da árvore de instalação de todo consumidor, ao lado da versão que ele
  realmente pediu.

  A correção já existia no código desde a quebra do ciclo `agents ↔ http`, mas nunca chegou a
  ninguém: `1.0.0` foi publicado antes dela e a versão não subiu, então o registry continuou servindo
  o manifesto antigo. Esta é a release que entrega o fix.

  Nada a fazer para migrar. Quem depende de `@theokit/agents` continua declarando essa dependência
  normalmente — a diferença é que agora só uma cópia é instalada.

## 1.0.0

### Major Changes

- b77cf03: **Agent decorators removed — authoring is now capability composition (M53).**

  BREAKING for `@theokit/agents`: every **agent** decorator is gone. The `@theokit/http` **controller**
  decorators (`@Controller`/`@Get`/`@Post`/`@UseGuards`) are untouched.

  - **Removed:** `@Agent`, `@MainLoop`, `@Tool`, `@Toolbox`, `@HumanInTheLoop`, `@Skills`, `@Memory`,
    `@ContextWindow`, `@ProjectContext`, `@MCP`, `@Guardrails`, `@Checkpoint`, `@SubAgents`,
    `@Compaction`, `@Gateway`, `@Trace`, `@Audit`, `@RequiresApproval`, `@Mixin` — plus nine that
    wrote metadata **no production code read** (`@Artifact`, `@Hook`, `@Observable`, `@Sandbox`,
    `@EditFormat`, `@Model`, `@RequiresCapability`, `@Policy`, `@Budget`). `@Model` never set the
    model and `@Sandbox` never sandboxed anything; deleting them removes no behavior.
  - **Replacement:** `applyCapabilities([...])` composing `ModelCapability`, `AgentConfigCapability`,
    `MainLoopCapability`, `ToolboxCapability`, `skills()`, `memory()`, `mcpServers()`, `guardrails()`,
    `checkpoint()` and friends. Conflicting declarations now fail with a typed
    `CapabilityConflictError` instead of last-write-wins, and `provenance` records which capability
    contributed each field.
  - **Also removed:** `bridge/walk-agent-metadata.ts` (the metadata walk) and `compileAgent`. The
    `reflect-metadata` **required peer dependency** and `experimentalDecorators`/
    `emitDecoratorMetadata` are gone from `packages/agents` — consumers of the agent surface can drop
    all three.
  - **BREAKING for `@theokit/http`:** `TheoApp.create({ agents })` and `agentsPlugin({ agents })` take
    prepared entries (`{ name, route, compiled }`) instead of decorated classes; `delegate()` and
    `AgentRunner` take a spec instead of a class (`AgentRunner.builder(Class)` →
    `AgentRunner.fromSpec(spec)`).

  Migration guide with the full decorator→capability map: [`MIGRATION.md`](./MIGRATION.md).

  Two real defects were found and fixed while doing this: every HTTP-served agent was silently running
  the **fallback model** (`@Agent({ model })` and `llmModel` were both dropped because `walk` was
  passed where `compiled` was expected, through an untyped dynamic import), and the agents branch of
  `TheoApp` had **no test at all** — `@theokit/agents` was never declared in `packages/http`'s
  `package.json`, so nothing could link it.

## 0.7.0

### Minor Changes

- acdf585: `@Expose` decorator — make an agent's exposure visible in one code review (M47, ADR-0059).

  Put a `@Controller('/api/agents')` class with `@Expose(chatAgent, { csrf: true })` (+ `@UseGuards(...)`) next to your other controllers, and a reviewer sees in one file WHAT the agent is (`chatAgent`, built separately in `agents/chat.ts`), WHERE it's served (`POST /api/agents/chat`), and its security. The agent stays built separately; the exposure is explicit and opt-in — the zero-config `agents/*.ts` convention is unchanged.

  On the frontend, `import { chat } from '@theo/agents'; useAgent(chat)` binds with **no magic string and no duplicated input type**: the path comes from the generated typed handle and `send` is inferred from the agent's `.input()` (cmd-click `chat` → `agents/chat.ts`). The same handle drives every surface — web `useAgent(chat)`, terminal `useAgent(chat.inProcess(run))`, desktop `createAgentClient(chat.channel(source))`.

  - `@theokit/http` gains the `Expose` decorator + `ExposeOptions`/`ExposeEntry` types, the `WalkResult.agent` field, a `serveAgent` seam on `createDecoratorHandler` (http stays agent-runtime agnostic), and `@UseGuards` widened to a `PropertyDecorator` (per-agent auth on the `@Expose` property).
  - `theokit` gains `AgentHandle` / `agentHandle` in `theokit/client`, a `useAgent(handle)` overload, and codegen that emits one typed handle per agent.
  - One runtime under it all (`mountAgent`): `@Expose`, `@Agent`, and the file convention are authoring surfaces, not competing paths (a grep gate proves no parallel agent streamer ships).

## 0.6.0

### Minor Changes

- 55afcec: Decorator controllers now reach parity with file-based `route()` inside a theokit app (#122).

  Put a `@Controller` class in `server/controllers/*.controller.ts` and in `theokit dev` its routes are **served** alongside file-based routes — sharing CSRF, security headers, CORS, rate-limit, and plugins — and **typed** in `@theo/client` as `client.<ns>.<method>()` with the response type inferred from the handler and `:id` params typed from the route pattern. File-based routes take precedence; a controller only answers paths they miss.

  - File-based routes, the deploy manifest, and the routes-only typed client are unchanged (the swc transform is a strict no-op outside `controllers/`; controllers stay out of `generateManifest`).
  - Request `@Body`/`@Query` types are `unknown` for now — parameter decorators are invisible to the type system (#124); runtime `@Body` Zod validation is unaffected.
  - Production `theokit start` serving of controllers is tracked separately (#123).
  - `@theokit/http` gains `transformControllerSource`, `createDecoratorHandler`, `isControllerClass`, `loadControllerWithSwc`, `loadControllersFromGlob` + supporting types so the framework reuses http's swc + dispatch rather than duplicating them.

## [Unreleased]

## [0.1.0-alpha.0] - 2026-06-08

### Added

- `@Controller(prefix?, opts?)` class decorator with optional host sub-domain matching
- 8 HTTP-verb method decorators: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All`
- 9 parameter decorators: `@Req`, `@Res`, `@Body`, `@Param`, `@Query`, `@Headers`, `@Session`, `@Ip`, `@HostParam`
- 3 response-shape decorators: `@HttpCode`, `@Header`, `@Redirect`
- `@UseGuards(...guards)` and `@UseInterceptors(...interceptors)` class/method decorators
- Bridge engine: `walkControllerMetadata()` produces structured `WalkResult[]` from decorator metadata
- `registerControllers([...])` low-level API with dedup + warn on duplicates
- `resolveDtoSchema()` for Pattern D2 (Zod `static schema` convention on DTO classes)
- `HttpDecoratorsConfigError` with actionable messages for missing `@Controller` and `emitDecoratorMetadata`
- `joinPath()` with leading/trailing slash normalization
- Metadata facade: 8 symbol keys + typed `setMeta`/`getMeta` wrappers over `reflect-metadata`
- 6 Pattern contract tests (D1-D6) verifying locked design decisions
- `theokit generate controller <name>` CLI verb extension
