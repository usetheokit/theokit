import type {
  HookName,
  HookResult,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  PluginContext,
  PluginErrorContext,
  PreHandlerHook,
  RunHookOptions,
  TheoApp,
  TheoPlugin,
} from '../plugin-types.js'

export class DuplicatePluginError extends Error {
  constructor(name: string) {
    super(`Plugin "${name}" is already registered.`)
    this.name = 'DuplicatePluginError'
  }
}

/**
 * @deprecated Per T3.1 (C1 plugin scope encapsulation) — duplicate decoration
 * keys across sibling plugins are now PERMITTED because each plugin gets its
 * own child scope via `Object.create(parent)` (Fastify pattern, ADR-0028
 * blueprint D1). This class is retained for one minor cycle so consumers who
 * `instanceof DuplicateDecorationError` continue to compile; the constructor
 * is no longer reachable from `PluginRunner.register()`. Removal scheduled
 * for 0.x+2 per CHANGELOG.
 */
export class DuplicateDecorationError extends Error {
  constructor(key: string, existingPlugin: string, newPlugin: string) {
    super(
      `Plugin "${newPlugin}" tried to decorate ctx.${key}, but it is already declared by plugin "${existingPlugin}".`,
    )
    this.name = 'DuplicateDecorationError'
  }
}

/**
 * Per-plugin scope built by `Object.create(parentApp)` at `register()` time
 * (T3.1 / Fastify `plugin-override.js:38` pattern). Each plugin's
 * `decorateRequest` calls populate THIS scope's `decorations` map only —
 * parent + sibling scopes are isolated through the JavaScript prototype chain.
 */
interface PluginScope {
  /** The child TheoApp instance whose proto chain points at `parentApp`. */
  app: TheoApp
  /** Per-plugin decorations map. Cross-plugin key collision is permitted. */
  decorations: Map<string, unknown>
}

export class PluginRunner {
  private plugins = new Set<string>()
  private pluginScopes = new Map<string, PluginScope>()
  private onRequestHooks: OnRequestHook[] = []
  private preHandlerHooks: PreHandlerHook[] = []
  private onResponseHooks: OnResponseHook[] = []
  private onErrorHooks: OnErrorHook[] = []

  /**
   * Parent app — proto-chain root for all child scopes. Has its OWN empty
   * decorations map (parent never receives `decorateRequest` calls under
   * the T3.1 contract; only child scopes do).
   */
  private parentDecorations = new Map<string, unknown>()
  private parentApp: TheoApp = this.buildParentAppFacade()

  has(name: string): boolean {
    return this.plugins.has(name)
  }

  /**
   * Per T3.1 (C1 plugin scope encapsulation):
   * 1. Reserve the plugin name (still rejects duplicates).
   * 2. Build a CHILD TheoApp via `Object.create(parentApp)` — Fastify
   *    `plugin-override.js:38` pattern. The child's own `decorateRequest`
   *    populates per-scope `decorations`; the child's `addHook` still
   *    forwards into the shared hook lists (hooks ARE process-global —
   *    only decorations are scoped, mirroring Fastify's decoration vs
   *    hook semantics).
   * 3. Invoke `plugin.register(childApp)`.
   *
   * Cross-plugin decoration-key collisions are PERMITTED (per blueprint
   * D1). The legacy `DuplicateDecorationError` is no longer thrown.
   */
  async register(plugin: TheoPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new DuplicatePluginError(plugin.name)
    }
    // Add to registry FIRST so duplicate detection works even if register throws.
    this.plugins.add(plugin.name)

    const scope = this.buildPluginScope(plugin.name)
    this.pluginScopes.set(plugin.name, scope)

    try {
      await plugin.register(scope.app)
    } catch (err) {
      // Roll back partial registration so a failed plugin does not leave
      // half-mounted state (T1.1 BDD "error scenario: plugin throws in
      // register → parent recovery is clean").
      this.plugins.delete(plugin.name)
      this.pluginScopes.delete(plugin.name)
      throw err
    }
  }

  /**
   * Build the parent app facade. Hooks forward to shared lists.
   * `decorateRequest` writes into the parent decorations map — used only
   * if a future consumer registers a non-plugin "app-level" decoration
   * directly. T3.1 contract: plugins decorate ONLY through child scopes.
   */
  private buildParentAppFacade(): TheoApp {
    const facade: TheoApp = {
      addHook: (name: HookName, fn: unknown) => {
        this.routeHookByName(name, fn)
      },
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T documents the per-decoration type for consumers
      decorateRequest: <T>(key: string, value: T) => {
        this.parentDecorations.set(key, value)
      },
    }
    return facade
  }

  /**
   * Build a child scope via `Object.create(parentApp)` so the child
   * inherits the parent's facade methods through the prototype chain.
   * Then override `decorateRequest` on the child instance so writes
   * land in the per-scope `decorations` map (parent is NOT mutated).
   */
  private buildPluginScope(_pluginName: string): PluginScope {
    const decorations = new Map<string, unknown>()
    const childApp: TheoApp = Object.create(this.parentApp) as TheoApp
    // Override decorateRequest on the child instance — parent's facade
    // method stays untouched, so `getParentApp().decorateRequest` still
    // writes to parentDecorations. This is the canonical Fastify pattern.
    // `_pluginName` reserved for future per-scope diagnostics (underscore
    // prefix marks intentional unused param per project lint convention).
    Object.defineProperty(childApp, 'decorateRequest', {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T documents the per-decoration type for consumers
      value: <T>(key: string, value: T) => {
        if (typeof key !== 'string') {
          throw new TypeError(
            `decorateRequest: invalid key (expected string, got ${typeof key}). ` +
              `Plugin authors MUST pass string keys.`,
          )
        }
        decorations.set(key, value)
      },
      enumerable: false,
      writable: false,
      configurable: false,
    })
    // Expose `decorations` on the child instance so `getPluginScope()`
    // consumers (devtools, tests) can introspect without touching this
    // private map. Read-only property — the JS prototype chain rule means
    // child.decorations shadows any parent.decorations the proto exposes.
    Object.defineProperty(childApp, 'decorations', {
      get: () => Object.fromEntries(decorations),
      enumerable: false,
      configurable: false,
    })
    return { app: childApp, decorations }
  }

  private routeHookByName(name: HookName, fn: unknown): void {
    switch (name) {
      case 'onRequest':
        this.onRequestHooks.push(fn as OnRequestHook)
        return
      case 'preHandler':
        this.preHandlerHooks.push(fn as PreHandlerHook)
        return
      case 'onResponse':
        this.onResponseHooks.push(fn as OnResponseHook)
        return
      case 'onError':
        this.onErrorHooks.push(fn as OnErrorHook)
        return
    }
  }

  /**
   * Apply ALL plugin scopes' decorations into the request ctx. Per T3.1,
   * sibling plugins MAY decorate the same key — last-writer-wins at apply
   * time (ordering = registration order). This keeps the legacy
   * `ctx.<key>` flat surface working for consumers that already aggregate
   * decorations into a single bag.
   */
  applyDecorations(ctx: Record<string, unknown>): void {
    for (const scope of this.pluginScopes.values()) {
      for (const [key, value] of scope.decorations.entries()) {
        ctx[key] = value
      }
    }
  }

  /**
   * Apply ONLY one plugin's scoped decorations into `target`. Used by
   * the T1.1 RED-3 test (sibling isolation proof) and by future scope-aware
   * dispatch paths. Throws if the plugin name isn't registered.
   */
  applyScopedDecorations(pluginName: string, target: Record<string, unknown>): void {
    const scope = this.pluginScopes.get(pluginName)
    if (!scope) throw new Error(`PluginRunner: unknown plugin "${pluginName}"`)
    for (const [key, value] of scope.decorations.entries()) {
      target[key] = value
    }
  }

  /** T1.1 RED-1/RED-4 introspection: returns the child TheoApp built for `pluginName`. */
  getPluginScope(pluginName: string): TheoApp {
    const scope = this.pluginScopes.get(pluginName)
    if (!scope) throw new Error(`PluginRunner: unknown plugin "${pluginName}"`)
    return scope.app
  }

  /** T1.1 RED-4: returns the parent TheoApp (root of every child's proto chain). */
  getParentApp(): TheoApp {
    return this.parentApp
  }

  /** T1.1 RED-2: returns the parent's decorations map (NEVER touched by plugin decorate calls under T3.1 contract). */
  getParentDecorations(): Map<string, unknown> {
    return this.parentDecorations
  }

  async runOnRequest(ctx: PluginContext): Promise<HookResult> {
    return this.runHookList(this.onRequestHooks, ctx)
  }

  async runPreHandler(ctx: PluginContext): Promise<HookResult> {
    return this.runHookList(this.preHandlerHooks, ctx)
  }

  async runOnResponse(ctx: PluginContext, options: RunHookOptions = {}): Promise<HookResult> {
    return this.runHookList(this.onResponseHooks, ctx, options)
  }

  /**
   * Run all onError hooks. Swallows errors thrown inside hooks themselves to
   * prevent recursion (an error in an error handler must not trigger onError
   * again).
   */
  async runOnError(ctx: PluginContext, error: unknown): Promise<HookResult> {
    const errorCtx: PluginErrorContext = { ...ctx, error }
    for (const hook of this.onErrorHooks) {
      try {
        await hook(errorCtx)
      } catch (innerErr) {
        // EC-9 + onError-safety: swallow to avoid recursion. Diagnostic
        // surface only — error context is preserved via innerErr arg.
        console.error(
          `[plugin-runner] onError hook threw; suppressed to avoid recursion:`,
          innerErr,
        )
      }
    }
    return { shortCircuited: false }
  }

  private async runHookList(
    hooks: readonly ((ctx: PluginContext) => void | Promise<void>)[],
    ctx: PluginContext,
    options: RunHookOptions = {},
  ): Promise<HookResult> {
    for (const hook of hooks) {
      try {
        await hook(ctx)
      } catch (err) {
        if (options.inErrorPath) {
          // EC-9: we're already handling an error; do NOT trigger onError again.
          // Diagnostic surface only — original error preserved via err arg.
          console.error(`[plugin-runner] hook threw during error path; suppressed (EC-9):`, err)
          continue
        }
        throw err
      }
      if (ctx.response.writableEnded || ctx.response.headersSent) {
        return { shortCircuited: true }
      }
    }
    return { shortCircuited: false }
  }
}
