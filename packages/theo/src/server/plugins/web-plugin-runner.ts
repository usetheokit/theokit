/**
 * T5a.2 Phase G slice 2/N — Web-Standards plugin runner.
 *
 * Mirror of `PluginRunner` for the Web Request shape. Same C1 plugin
 * scope encapsulation invariant (Fastify `Object.create(parent)`
 * pattern per T3.1 + ADR-0028 blueprint D1): each plugin gets a CHILD
 * `WebTheoApp` whose `decorateRequest` writes into a per-plugin scope
 * Map; cross-plugin decoration-key collisions PERMITTED (sibling
 * isolation via the JS prototype chain).
 *
 * **Signature differences vs `PluginRunner`:**
 *   - Hook arrays type `WebOnRequestHook[]` / `WebPreHandlerHook[]` / etc.
 *     (instead of the IncomingMessage-shaped hooks).
 *   - `getHooks()` exposes the registered hook arrays in a shape that
 *     `executeWebRequest`'s `opts.hooks` consumes directly — Phase G
 *     slice 1/N landing zone for plugin-registered hooks.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G.
 */
import type {
  HookName,
  WebHookByName,
  WebOnErrorHook,
  WebOnRequestHook,
  WebOnResponseHook,
  WebPreHandlerHook,
  WebTheoApp,
  WebTheoPlugin,
} from '../plugin-types.js'

import { DuplicatePluginError } from './plugin-runner.js'

/**
 * Per-plugin scope built by `Object.create(parentApp)` at `register()`
 * time. Each plugin's `decorateRequest` calls populate THIS scope's
 * `decorations` map only — parent + sibling scopes are isolated through
 * the JS prototype chain (T3.1 invariant).
 */
interface WebPluginScope {
  app: WebTheoApp
  decorations: Map<string, unknown>
}

export class WebPluginRunner {
  private plugins = new Set<string>()
  private pluginScopes = new Map<string, WebPluginScope>()
  private onRequestHooks: WebOnRequestHook[] = []
  private preHandlerHooks: WebPreHandlerHook[] = []
  private onResponseHooks: WebOnResponseHook[] = []
  private onErrorHooks: WebOnErrorHook[] = []
  private parentDecorations = new Map<string, unknown>()
  private parentApp: WebTheoApp = this.buildParentAppFacade()

  has(name: string): boolean {
    return this.plugins.has(name)
  }

  /**
   * Register a plugin. Reserves the name (rejects duplicates with
   * `DuplicatePluginError`), builds a child `WebTheoApp` via
   * `Object.create(parentApp)` for sibling isolation, invokes
   * `plugin.register(childApp)`. Rolls back on throw — failed plugin
   * leaves no half-mounted state.
   */
  async register(plugin: WebTheoPlugin): Promise<void> {
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
      // Roll back partial registration (T1.1 BDD error scenario).
      this.plugins.delete(plugin.name)
      this.pluginScopes.delete(plugin.name)
      throw err
    }
  }

  private buildParentAppFacade(): WebTheoApp {
    return {
      addHook: <K extends HookName>(name: K, fn: WebHookByName<K>) => {
        this.routeHookByName(name, fn)
      },
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T documents the per-decoration type for consumers
      decorateRequest: <T>(key: string, value: T) => {
        this.parentDecorations.set(key, value)
      },
    }
  }

  private buildPluginScope(_pluginName: string): WebPluginScope {
    const decorations = new Map<string, unknown>()
    const childApp: WebTheoApp = Object.create(this.parentApp) as WebTheoApp
    // Override decorateRequest on the child so writes land in per-scope map.
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
        this.onRequestHooks.push(fn as WebOnRequestHook)
        return
      case 'preHandler':
        this.preHandlerHooks.push(fn as WebPreHandlerHook)
        return
      case 'onResponse':
        this.onResponseHooks.push(fn as WebOnResponseHook)
        return
      case 'onError':
        this.onErrorHooks.push(fn as WebOnErrorHook)
        return
    }
  }

  /**
   * Apply ALL plugin scopes' decorations into the request ctx. Sibling
   * plugins MAY decorate the same key — last-writer-wins at apply time
   * (registration order). Same semantic as `PluginRunner.applyDecorations`.
   */
  applyDecorations(ctx: Record<string, unknown>): void {
    for (const scope of this.pluginScopes.values()) {
      for (const [key, value] of scope.decorations.entries()) {
        ctx[key] = value
      }
    }
  }

  /**
   * Expose the registered hook arrays in the shape `executeWebRequest`'s
   * `opts.hooks` accepts. Adapters consume this directly:
   *
   *   const runner = new WebPluginRunner()
   *   await runner.register(corsPlugin)
   *   await runner.register(authPlugin)
   *   const response = await executeWebRequest(request, routes, {
   *     hooks: runner.getHooks(),
   *   })
   */
  getHooks(): {
    onRequest: readonly WebOnRequestHook[]
    preHandler: readonly WebPreHandlerHook[]
    onResponse: readonly WebOnResponseHook[]
    onError: readonly WebOnErrorHook[]
  } {
    return {
      onRequest: this.onRequestHooks,
      preHandler: this.preHandlerHooks,
      onResponse: this.onResponseHooks,
      onError: this.onErrorHooks,
    }
  }

  /** Returns the child WebTheoApp built for `pluginName` (introspection). */
  getPluginScope(pluginName: string): WebTheoApp {
    const scope = this.pluginScopes.get(pluginName)
    if (!scope) throw new Error(`WebPluginRunner: unknown plugin "${pluginName}"`)
    return scope.app
  }

  /** Returns the parent WebTheoApp (root of every child's proto chain). */
  getParentApp(): WebTheoApp {
    return this.parentApp
  }

  /** Returns the parent's decorations map (never touched by plugin decorates). */
  getParentDecorations(): Map<string, unknown> {
    return this.parentDecorations
  }
}
