# Changelog

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
