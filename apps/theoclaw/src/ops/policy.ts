import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Workspace policy file checked by `theoclaw doctor` (OC-139). A JSON file
 * `{"rules":[{"id":"no-open-dm","variable":"THEOCLAW_DM_POLICY","forbid":["open"]}]}`.
 * A rule may `forbid` values, or `require` that the variable is one of the listed values.
 * The file is `THEOCLAW_POLICY_FILE`, else `policy.json` beside the configuration file; a
 * missing default file means no policy. Violations name the rule and the variable, never a value.
 */

interface PolicyRule {
  readonly id: string
  readonly variable: string
  readonly forbid?: readonly string[]
  readonly require?: readonly string[]
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function parseRules(text: string): PolicyRule[] | string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return 'is not valid JSON'
  }
  const rules = (data as { rules?: unknown } | null)?.rules
  if (!Array.isArray(rules)) return 'has no "rules" array'
  const out: PolicyRule[] = []
  for (const [index, raw] of rules.entries()) {
    const rule = raw as Record<string, unknown> | null
    if (
      rule === null ||
      typeof rule !== 'object' ||
      typeof rule.id !== 'string' ||
      rule.id === '' ||
      typeof rule.variable !== 'string' ||
      rule.variable === '' ||
      (rule.forbid !== undefined && !isStrings(rule.forbid)) ||
      (rule.require !== undefined && !isStrings(rule.require)) ||
      (rule.forbid === undefined && rule.require === undefined)
    ) {
      return `rule ${index + 1} needs "id", "variable" and a "forbid" or "require" list of strings`
    }
    out.push(rule as unknown as PolicyRule)
  }
  return out
}

/** The failure lines of the workspace policy against `env`; empty when it holds or no file exists. */
export function checkPolicy(env: NodeJS.ProcessEnv, configPath: string): string[] {
  const explicit = (env.THEOCLAW_POLICY_FILE ?? '').trim()
  const path = explicit !== '' ? explicit : join(dirname(configPath), 'policy.json')
  if (!existsSync(path)) return explicit !== '' ? [`policy: THEOCLAW_POLICY_FILE names a file that does not exist`] : []
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return [`policy: ${path} cannot be read`]
  }
  const rules = parseRules(text)
  if (typeof rules === 'string') return [`policy: ${path} ${rules}`]
  const failures: string[] = []
  for (const rule of rules) {
    const value = (env[rule.variable] ?? '').trim()
    if (rule.forbid?.includes(value) === true) failures.push(`policy ${rule.id}: ${rule.variable} is set to a forbidden value`)
    else if (rule.require !== undefined && !rule.require.includes(value)) {
      failures.push(`policy ${rule.id}: ${rule.variable} is not one of the required values`)
    }
  }
  return failures
}
