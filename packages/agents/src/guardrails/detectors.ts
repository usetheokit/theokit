/**
 * M9 (theokit-ai-first) — built-in guardrail detectors.
 *
 * Each factory returns a {@link Guardrail}. None call an LLM (G2 / sdk-runtime.md):
 * `outputModeration` takes an INJECTED predicate so the provider call (if any) lives in the
 * consumer's code, never in `packages/`.
 */
import { CostBudgetExceededError, type Guardrail, type GuardrailResult } from './types.js'

/** Rough token estimate — ~4 chars/token (documented heuristic; exact counting is provider-specific). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Known prompt-injection / jailbreak trigger phrases (lowercased). Matched via normalized
 * substring (not regex) — ReDoS-free by construction, since the guard runs on UNTRUSTED input
 * (security is never traded for terseness — parsimony-ladder § Never on the chopping block).
 */
const INJECTION_PHRASES: readonly string[] = [
  'previous instructions', // "ignore/disregard [all|the] previous instructions"
  'disregard the above',
  'you are now dan',
  'system prompt', // "reveal your/the system prompt"
  'no restrictions',
  'without restrictions',
  'no rules',
  'override your',
]

export interface PromptInjectionOptions {
  /** Additional project-specific trigger phrases (compared lowercased, substring). */
  extra?: readonly string[]
}

/** Collapse whitespace + lowercase so spacing/casing tricks do not evade the phrase match. */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ')
}

/** Blocks input containing a known injection trigger phrase. */
export function promptInjectionDetector(options: PromptInjectionOptions = {}): Guardrail {
  const phrases = [...INJECTION_PHRASES, ...(options.extra ?? []).map((p) => p.toLowerCase())]
  return {
    name: 'prompt-injection',
    checkInput(text): GuardrailResult {
      const normalized = normalizeForMatch(text)
      for (const phrase of phrases) {
        if (normalized.includes(phrase)) {
          return { action: 'block', reason: `prompt injection phrase matched: "${phrase}"` }
        }
      }
      return { action: 'allow' }
    },
  }
}

// PII patterns. CPF (Brazilian): 11 digits, optionally punctuated. Email + international phone.
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
// A run of 9–15 digit-ish characters (single bounded quantifier — ReDoS-safe, low complexity).
const PHONE = /\+?\d[\d\s()-]{7,13}\d/g

export interface PiiOptions {
  /** When true (default), matched PII is replaced with `[REDACTED]`. */
  redact?: boolean
  /** Placeholder token. Default `[REDACTED]`. */
  placeholder?: string
}

/** Redacts CPF, email and phone numbers from input. */
export function piiDetector(options: PiiOptions = {}): Guardrail {
  const placeholder = options.placeholder ?? '[REDACTED]'
  return {
    name: 'pii',
    checkInput(text): GuardrailResult {
      let redacted = text
      // Order matters: email before phone (an email's digits must not be eaten by PHONE).
      redacted = redacted.replace(EMAIL, placeholder)
      redacted = redacted.replace(CPF, placeholder)
      redacted = redacted.replace(PHONE, placeholder)
      if (redacted === text) return { action: 'allow' }
      return { action: 'redact', text: redacted, reason: 'PII detected and redacted' }
    },
  }
}

// Zero-width + bidi-override control characters used to hide/obfuscate text.
// U+200B–U+200D (zero-width space/ZWNJ/ZWJ), U+FEFF (ZWNBSP/BOM), U+202A–U+202E (bidi
// embeddings/overrides), U+2066–U+2069 (bidi isolates). Escapes (not literals) keep lint clean.
const OBFUSCATION_CHARS = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g

/** NFKC-normalizes and strips zero-width / RTL-override characters. */
export function unicodeNormalizer(): Guardrail {
  return {
    name: 'unicode-normalizer',
    checkInput(text): GuardrailResult {
      const cleaned = text.normalize('NFKC').replace(OBFUSCATION_CHARS, '')
      if (cleaned === text) return { action: 'allow' }
      return { action: 'redact', text: cleaned, reason: 'obfuscation characters normalized' }
    },
  }
}

export interface CostGuardOptions {
  /** Cumulative input-token budget per guard instance (per session — one guard per run). */
  maxTokens: number
}

/**
 * Enforces a cumulative input-token budget. Stateful: one instance accumulates across the calls
 * it sees within a run. Throws {@link CostBudgetExceededError} fail-fast when exceeded.
 */
export function costGuard(options: CostGuardOptions): Guardrail {
  let used = 0
  return {
    name: 'cost-guard',
    // Returns a Promise explicitly (not `async`) so a budget breach REJECTS uniformly — never a
    // sync throw — safe for direct callers and for the pipeline's `await g.checkInput()`.
    checkInput(text): Promise<GuardrailResult> {
      used += estimateTokens(text)
      if (used > options.maxTokens) {
        return Promise.reject(new CostBudgetExceededError(used, options.maxTokens))
      }
      return Promise.resolve({ action: 'allow' })
    },
  }
}

export interface OutputModerationOptions {
  /**
   * Injected predicate — returns `true` when the text is prohibited. The provider call (OpenAI
   * moderation API, a classifier, etc.) lives HERE, in consumer code — never inside `packages/`
   * (G2). Keeps the module runtime-free.
   */
  moderate: (text: string) => boolean | Promise<boolean>
}

/** Blocks model output the injected predicate flags as prohibited. */
export function outputModeration(options: OutputModerationOptions): Guardrail {
  return {
    name: 'output-moderation',
    async checkOutput(text): Promise<GuardrailResult> {
      const flagged = await options.moderate(text)
      return flagged
        ? { action: 'block', reason: 'output flagged by moderation predicate' }
        : { action: 'allow' }
    },
  }
}
