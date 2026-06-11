/**
 * PII masking heuristic for devtools Action Call records.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 5 / T5.1 + ADR D7.
 * EC absorbed: EC-12 (PII mask heuristic).
 *
 * Heuristic regex matches common sensitive field names. Walks objects and
 * arrays recursively. Documented limitations:
 * - Falses positives (`tokenize` → masked because matches `token`) accepted;
 *   click-to-reveal in the Actions tab mitigates.
 * - Falses negatives (PII in custom-named field like `userInput`) NOT detected.
 *   Documented in ADR D7 as accepted v1 limitation.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */

const SENSITIVE_KEY_PATTERN = /(password|token|secret|api_?key|apikey|credit_?card|ssn|cpf|cnpj)/i

/**
 * Check whether a field key matches the sensitive-name heuristic.
 * Case-insensitive; partial-match (e.g., `userPassword` matches).
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

/**
 * Deep-mask sensitive fields in a value. Returns a new object/array with
 * sensitive values replaced by `'***'`. Non-objects pass through unchanged.
 * Walks arrays element-wise.
 */
export function maskPiiFields(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => maskPiiFields(item))
  }
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = '***'
    } else {
      out[key] = maskPiiFields(val)
    }
  }
  return out
}
