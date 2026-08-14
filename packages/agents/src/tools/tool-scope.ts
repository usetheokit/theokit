import { writableRootsFor, type SandboxMode, type SandboxProvider } from '@theokit/sdk/sandbox'

/**
 * M78 — the tool scope binder: bind `{ projectRoot, writeRoot, sandbox }` once, so an unconfined
 * shell is unrepresentable.
 *
 * ## The defect this closes
 *
 * The framework shipped the ingredients — `createSandboxBackend`, `resolveSandboxPosture` — and no
 * binder. Measured against `@theokit/sdk-tools@0.26.1`: `projectRoot` is REQUIRED on eleven
 * factories, while `sandbox` is **optional** on three — `createGitDiffTool`, `createGitStatusTool`
 * and, the one that matters, `createShellTool`.
 *
 * An optional sandbox on a shell factory means a scope assembled without one produces an UNCONFINED
 * SHELL with no error and no warning. The consumer that prompted this milestone documented exactly
 * that outcome. And because nothing bound the roots either, every product rediscovered per tool
 * which root each factory accepts — with silence as the failure mode for getting it wrong.
 *
 * ## Why this is framework and not runtime
 *
 * It runs nothing. It applies configuration to factories the SDK owns — the boundary/home half of
 * ADR-0040 § D2, the same category as the approval gate and the ask channel.
 *
 * ## Why ONE generic `bind` and not eleven named wrappers
 *
 * The milestone wants the consumer's registry to become "the declarative map of ten entries it
 * should be". A generic `bind` IS that map:
 *
 * ```ts
 * const registry = {
 *   shell:     scope.bind(createShellTool)(),
 *   read_file: scope.bind(createReadFileTool)(),
 * }
 * ```
 *
 * Eleven named wrappers would add nothing to that and cost two things: a twelfth tool in `sdk-tools`
 * would need a change here (breaking OCP), and each wrapper is one more place to forget the sandbox —
 * the exact failure being closed. Parsimony rung 1: they do not need to exist.
 */

/** What a sandbox mode permits, in the two terms a tool factory actually needs. */
export interface SandboxWritePolicy {
  /** Whether ANY write is permitted. */
  readonly writes: boolean
  /** Whether a path outside the project root may be honoured. */
  readonly allowAbsolute: boolean
}

/**
 * The write policy of a sandbox mode.
 *
 * A PROJECTION of the SDK's own `writableRootsFor`, never a second source of truth (G12): products
 * were re-deriving this by hand, and a function that disagreed with the SDK would be a third
 * derivation — worse than the two it replaces. `tool-scope.test.ts` asserts the agreement for every
 * mode.
 *
 * The mapping is not guessable, which is why it is measured rather than assumed:
 *
 * | mode | `writableRootsFor` | meaning |
 * |---|---|---|
 * | `read-only` | `[]` | no writable root |
 * | `workspace-write` | `[cwd, '/tmp']` | writes, confined |
 * | `danger-full-access` | `null` | **unrestricted** — not "no writes" |
 *
 * Reading `null` as "nothing is writable" would forbid writes exactly where everything is allowed.
 */
export function sandboxWritePolicy(mode: SandboxMode, cwd: string): SandboxWritePolicy {
  // Widened through `unknown` because the SDK's signature (`readonly string[] | null`) does not
  // admit a value its implementation returns: for a mode outside the union it yields `undefined`,
  // measured. Without the widening, `no-unnecessary-condition` calls the guard below impossible and
  // the honest options are to delete it — reintroducing a `TypeError` on `.length` — or to say why
  // the declared type is narrower than reality. This is the second.
  const roots = writableRootsFor(mode, cwd) as unknown as readonly string[] | null | undefined
  // `cwd` is required rather than defaulted: the two booleans do not depend on it, but the SDK call
  // does, and passing a placeholder would make this look like an independent derivation.
  if (roots === null) return { writes: true, allowAbsolute: true }

  // Measured while writing the type test: for a mode outside the union, `writableRootsFor` returns
  // `undefined` — which its signature (`readonly string[] | null`) does not admit. The type is a
  // closed union, so this is only reachable from a product that read a mode out of config and cast
  // it; and that is precisely the caller who must not get a `TypeError` on `.length` three frames
  // deep. Fail fast, fail clear (Rule 8), naming the value and the alternatives.
  if (roots === undefined) {
    throw new TypeError(
      `[@theokit/agents] unknown sandbox mode ${JSON.stringify(mode)} — write policy is undefined ` +
        `for it. Expected one of: "read-only", "workspace-write", "danger-full-access". ` +
        `Refusing to guess: guessing permissive would grant writes, and guessing restrictive would ` +
        `silently disable a tool.`,
    )
  }
  return { writes: roots.length > 0, allowAbsolute: false }
}

/** The scope fields a bound factory receives. Every field is non-optional by the time it is applied. */
interface ScopeFields {
  readonly projectRoot: string
  readonly writeRoot: string
  readonly sandbox: SandboxProvider
}

export interface ToolScopeInput {
  /** Root the tools read from. */
  readonly projectRoot: string
  /**
   * Root the tools write to. Defaults to `projectRoot` — the conservative reading: a product that
   * never distinguishes the two should not have to say so twice, and the default must not be broader
   * than what was asked for.
   */
  readonly writeRoot?: string
  /**
   * The confinement. REQUIRED, and that is the entire milestone.
   *
   * Making it optional is what let a scope produce an unconfined shell in silence. A caller who
   * genuinely wants no confinement must say so by passing a `danger-full-access` sandbox — a
   * decision that appears in the code, in a review, and in a log, rather than an omission that
   * appears nowhere.
   */
  readonly sandbox: SandboxProvider
  /**
   * The mode `policy` is computed from. Optional because the policy is a convenience: a scope whose
   * product never asks about write policy needs no mode.
   */
  readonly mode?: SandboxMode
}

/** Any `sdk-tools` factory: takes an options object, returns a tool. */
type ToolFactory<TOptions, TTool> = (options: TOptions) => TTool

/**
 * Per-tool overrides.
 *
 * The scope fields are optional here — a caller may replace them — but `undefined` is treated as
 * "not supplied", never as "unset". See {@link ToolScope.bind}.
 */
type Overrides<TOptions> = Omit<TOptions, keyof ScopeFields> & Partial<ScopeFields>

export interface ToolScope extends ScopeFields {
  /** The write policy of `mode`, when one was supplied. */
  readonly policy: SandboxWritePolicy
  /**
   * Scope a factory.
   *
   * Returns a function taking that tool's own options. Scope fields are injected; an override may
   * REPLACE one, but an `undefined` override falls back to the scope rather than clearing it.
   *
   * That asymmetry is the point. Variation is legitimate — one tool may need stricter confinement
   * than the rest, which is the risk the milestone flags. Absence is not: `{ sandbox: maybeSandbox }`
   * with an undefined variable is ordinary code, and honouring it would silently unconfine a shell
   * through the one door the type system cannot close.
   */
  bind<TOptions extends Partial<ScopeFields>, TTool>(
    factory: ToolFactory<TOptions, TTool>,
  ): (overrides?: Overrides<TOptions>) => TTool
}

/**
 * A bound scope.
 *
 * A class rather than a closure so the scope is INSPECTABLE: `scope.projectRoot`, `scope.policy` and
 * `scope.sandbox` are readable by a diagnostic (`theokit doctor`, M84) and by a test, which a
 * captured closure would hide. The fields are readonly — a scope that could be mutated after tools
 * were bound would let confinement change under a tool already holding it.
 */
class BoundToolScope implements ToolScope {
  readonly projectRoot: string
  readonly writeRoot: string
  readonly sandbox: SandboxProvider
  readonly policy: SandboxWritePolicy

  constructor(input: ToolScopeInput) {
    this.projectRoot = input.projectRoot
    this.writeRoot = input.writeRoot ?? input.projectRoot
    this.sandbox = input.sandbox
    // No mode ⇒ report the safe answer rather than invent a permissive one. A product that never
    // declared a mode has not earned `writes: true`.
    this.policy =
      input.mode === undefined
        ? { writes: false, allowAbsolute: false }
        : sandboxWritePolicy(input.mode, this.projectRoot)
  }

  bind<TOptions extends Partial<ScopeFields>, TTool>(
    factory: ToolFactory<TOptions, TTool>,
  ): (overrides?: Overrides<TOptions>) => TTool {
    return (overrides) => {
      const merged = {
        ...overrides,
        // AFTER the spread, and each with `??`: an override may replace a scope field, but an
        // explicit `undefined` resolves back to the scope instead of clearing it.
        projectRoot: overrides?.projectRoot ?? this.projectRoot,
        writeRoot: overrides?.writeRoot ?? this.writeRoot,
        sandbox: overrides?.sandbox ?? this.sandbox,
      } as TOptions
      return factory(merged)
    }
  }
}

/**
 * Bind a tool scope.
 *
 * ```ts
 * const scope = bindToolScope({ projectRoot, sandbox: await resolveSandbox({ mode }) , mode })
 * const shell = scope.bind(createShellTool)({ name: 'run_shell' })
 * ```
 *
 * Omitting `sandbox` does not compile — see `tests/type/tool-scope.test-d.ts`.
 */
export function bindToolScope(input: ToolScopeInput): ToolScope {
  return new BoundToolScope(input)
}
