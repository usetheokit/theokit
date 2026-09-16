export interface EnvKnob {
  readonly name: string
  readonly reader: string
  readonly default: string
  readonly effect: string
}

const AB = 'THEOCODE_'

export const ENV_MODEL = `${AB}MODEL`
export const ENV_REASONING_EFFORT = `${AB}REASONING_EFFORT`
export const ENV_SANDBOX_MODE = `${AB}SANDBOX_MODE`
export const ENV_APPROVAL_POLICY = `${AB}APPROVAL_POLICY`
export const ENV_GOAL_ORACLE = `${AB}GOAL_ORACLE`
export const ENV_OUTPUT_STYLE = `${AB}OUTPUT_STYLE`
export const ENV_CONTEXT_WINDOW = `${AB}CONTEXT_WINDOW`
export const ENV_SHELL_TIMEOUT_MS = `${AB}SHELL_TIMEOUT_MS`
export const ENV_MEMORY = `${AB}MEMORY`
export const ENV_SESSION_GC = `${AB}SESSION_GC`
const ENV_PROVIDER = `${AB}PROVIDER`
export const ENV_HOME = `${AB}HOME`
const ENV_THEOKIT_HOME = 'THEOKIT_HOME'
const ENV_THEOKIT_AUTH_HOME = 'THEOKIT_AUTH_HOME'
export const ENV_TRUST_ALL_DIRS = `${AB}TRUST_ALL_DIRS`
export const ENV_TRUST_ALL_DIRS_LEGACY = 'THEOKIT_TRUST_ALL_DIRS'
const ENV_OPENROUTER_API_KEY = 'OPENROUTER_API_KEY'
const ENV_LIVE_MODEL = 'LIVE_MODEL'
const ENV_SHELL = 'SHELL'

const ENV_DIAGNOSTICS = 'THEOCODE_DIAGNOSTICS'
const ENV_THEME = 'THEOCODE_THEME'
const ENV_NO_COLOR = 'NO_COLOR'
const ENV_SEARCH_API_URL = 'THEOKIT_SEARCH_API_URL'

const ENV_ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY'
const ENV_OPENAI_API_KEY = 'OPENAI_API_KEY'

const CONFIG = 'packages/agent/src/config/config.ts:resolveConfig'
const CREDENTIALS = 'packages/agent/src/auth/credentials.ts:resolveCredential'

export const ENV_KNOBS: readonly EnvKnob[] = [
  {
    name: ENV_MODEL,
    reader: CONFIG,
    default: 'openai/gpt-5.6-terra',
    effect: 'Switches the model. Wins over every `config.toml` layer.',
  },
  {
    name: ENV_REASONING_EFFORT,
    reader: CONFIG,
    default: 'medium',
    effect: 'Reasoning level (`minimal` … `xhigh`). A value outside the set fails loud.',
  },
  {
    name: ENV_SANDBOX_MODE,
    reader: CONFIG,
    default: 'workspace-write',
    effect:
      'Tool confinement: `read-only` registers no write tool; `danger-full-access` raises the write root to `/`.',
  },
  {
    name: ENV_APPROVAL_POLICY,
    reader: CONFIG,
    default: 'on-request',
    effect: 'When the human is consulted before a gated tool.',
  },
  {
    name: ENV_GOAL_ORACLE,
    reader: CONFIG,
    default: 'judge',
    effect:
      'Who decides the objective is done: the LLM judge (+1 call per turn) or the `update_goal` tool the model calls itself.',
  },
  {
    name: ENV_OUTPUT_STYLE,
    reader: CONFIG,
    default: '—',
    effect:
      "The output style to apply, by name — a `.md` file under `~/.claude/output-styles/` or the project's. Absent means the built-in instructions, unchanged. A style REPLACES them unless its frontmatter says `keep-coding-instructions: true`.",
  },
  {
    name: ENV_CONTEXT_WINDOW,
    reader: CONFIG,
    default: '—',
    effect:
      'The model context window, in tokens. A positive integer; absent ⇒ the window comes from the model catalogue, with the conservative floor when the catalogue does not know it.',
  },
  {
    name: ENV_SHELL_TIMEOUT_MS,
    reader: CONFIG,
    default: '10000',
    effect:
      'Milliseconds before an operator-supplied shell command (`/…` custom command expansion) is killed. A positive integer; the hook engine has always had the equivalent per-hook `timeout_ms`.',
  },
  {
    name: ENV_MEMORY,
    reader: CONFIG,
    default: 'false',
    effect:
      'Durable memory across sessions. `1`/`true`/`yes`/`on` and their negatives; an unrecognised value fails loud rather than being read as off. Off by default — see `AgentConfig.memory` for the measured cost.',
  },
  {
    name: ENV_SESSION_GC,
    reader: CONFIG,
    default: 'true',
    effect:
      'Whether the session collector runs on its own, at most once a day, applying the SAME 30-day window, 1-day floor and operation budget `sessions gc` uses. `0`/`false` keeps collection manual.',
  },
  {
    name: ENV_PROVIDER,
    reader: CREDENTIALS,
    default: '—',
    effect:
      'Declares the provider explicitly. FAIL-CLOSED: if its key is absent, resolution aborts instead of falling back to another account credential.',
  },
  {
    name: ENV_HOME,
    reader: 'packages/agent/src/auth/oauth-config.ts:HOME_ENV',
    default: '~/.theocode',
    effect: 'Moves the credential store directory (`auth.json`).',
  },
  {
    name: ENV_THEOKIT_HOME,
    reader: 'packages/agent/src/session/session-ops.ts:legacyRootHint',
    default: '~/.theokit',
    effect:
      'Root of the runtime state, including session transcripts. Changing it moves `/sessions`, `/backtrack` and `sessions gc` along with it.',
  },
  {
    name: ENV_THEOKIT_AUTH_HOME,
    reader: 'packages/agent/src/auth/credentials.ts:ensureAuthHome',
    default: 'derived from `THEOCODE_HOME`',
    effect:
      'Points the SDK ambient credential store at this product one. Set at startup when absent; an explicit operator value wins.',
  },
  {
    name: ENV_TRUST_ALL_DIRS,
    reader: 'packages/agent/src/config/trust-posture.ts:resolveTrustPosture',
    default: '—',
    effect:
      'CI/headless escape: `=1` treats EVERY directory as trusted. It switches off the defence against a hostile repository — only in a context you already control. The resulting posture carries `source: "env"`.',
  },
  {
    name: ENV_TRUST_ALL_DIRS_LEGACY,
    reader: 'packages/agent/src/config/trust-posture.ts:resolveTrustPosture',
    default: '—',
    effect:
      'DEPRECATED — an alias of `THEOCODE_TRUST_ALL_DIRS`. It still grants, and emits a stderr warning once per process. Slated for removal; no date is promised, because this repository has no roadmap to promise one against.',
  },
  {
    name: ENV_DIAGNOSTICS,
    reader: 'packages/shared/src/diagnostic-sink.ts:installDiagnosticSink',
    default: 'off',
    effect:
      'Where the framework writes its diagnostics (`stderr`). The documented recovery path for a ' +
      'masked turn failure: `turn-error.ts` records a turn whose real cause was a RateLimitError ' +
      'that only this knob could reveal. Unset is indistinguishable from disabled, which is why it ' +
      'has to be findable.',
  },
  {
    name: ENV_THEME,
    reader: 'packages/tui/src/theme/theme.ts:resolveTheme',
    default: '—',
    effect:
      'Forces the colour theme by name. Outranks the `/theme` command and `NO_COLOR`; a value ' +
      'outside the set is reported by `/status` and `/theme` rather than applied.',
  },
  {
    name: ENV_NO_COLOR,
    reader: 'packages/tui/src/theme/theme.ts:resolveTheme',
    default: '—',
    effect:
      'The cross-tool convention (no-color.org): any value disables colour. `THEOCODE_THEME` wins ' +
      'over it, deliberately — an explicit theme is a narrower instruction than a global default.',
  },
  {
    name: ENV_SEARCH_API_URL,
    reader: 'packages/agent/src/chat/chat.ts:webSearchConfigured',
    default: '—',
    effect:
      'The web-search provider endpoint. Absent or misspelt, `web_search` is not declared to the ' +
      'model at all and its approval entry is omitted — the capability disappears silently, which ' +
      'looks identical to a model that chose not to search.',
  },
  {
    name: ENV_OPENROUTER_API_KEY,
    reader: CREDENTIALS,
    default: '—',
    effect: 'Provider key. First in the precedence order (default gateway).',
  },
  {
    name: ENV_ANTHROPIC_API_KEY,
    reader: CREDENTIALS,
    default: '—',
    effect: 'Provider key. Second in the precedence order.',
  },
  {
    name: ENV_OPENAI_API_KEY,
    reader: CREDENTIALS,
    default: '—',
    effect: 'Provider key. Third in the precedence order.',
  },
  {
    name: ENV_LIVE_MODEL,
    reader: 'packages/agent/src/delegation/roles.ts:resolveEffort',
    default: 'google/gemini-2.5-flash-lite',
    effect: 'The model used by the live test harnesses. It does not affect the product runtime.',
  },
  {
    name: ENV_SHELL,
    reader: 'packages/tui/src/commands/config-commands.ts:handleCustomCommand',
    default: '/bin/sh',
    effect: 'The shell used to expand a user custom command in the TUI.',
  },
  // M111 (promotion unblock): the four `theo-promptly` knobs arrived with the persona resolved
  // per service and were born outside the registry — the M104 gate caught them, which is exactly what
  // it exists to do. Registered here so the environment surface is derivable from ONE list.
  //
  // This line used to say "so `docs/CONFIGURATION.md` is derivable again". That file has never
  // existed in this repository. The `reader`-path gate only checks `ENV_KNOBS[].reader`, so a
  // citation in prose beside it was invisible — the same shape as B-134, one field over.
  // The README's configuration table is the document this list feeds.
]
