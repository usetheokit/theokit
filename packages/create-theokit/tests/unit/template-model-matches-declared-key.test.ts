/**
 * A scaffold must not ask for one key and declare a model that needs another (theokit#554).
 *
 * A fresh app given only the key `.env.example` asks for answered 500 on its first message: the
 * generated agent declared `openai/gpt-4o-mini`, and the resolver reads a registered prefix as a
 * hard provider selection, so it demanded `OPENAI_API_KEY` — the one key the user was never told
 * to get.
 *
 * The scaffold's docblock claimed the opposite, that the prefix let OpenRouter route the model
 * upstream. Measured against `@theokit/sdk`'s own provider catalog, it does not:
 * `openai/gpt-4o-mini` resolves to `api.openai.com`, and only `openrouter/openai/gpt-4o-mini`
 * resolves to `openrouter.ai`. The gateway has to be NAMED in the id; a bare vendor prefix is a
 * selection of that vendor.
 *
 * So the invariant is about coherence, not about a particular model: whatever key the scaffold
 * tells the reader to obtain must be the key its declared models actually need. Both sides are
 * read from the templates, so changing either one alone fails here rather than at a user's first
 * message.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '../../templates')

function everyTemplateFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? everyTemplateFile(full) : [full]
  })
}

/**
 * The provider the scaffold tells the reader to credential: the one `.env.example` leaves
 * UNCOMMENTED. A commented line is a suggestion; an uncommented one is what `cp .env.example .env`
 * produces, and therefore what a first run actually has.
 */
function declaredProviderKey(): string {
  const env = readFileSync(join(TEMPLATES, 'default', '.env.example'), 'utf8')
  const keys = [...env.matchAll(/^([A-Z0-9_]+_API_KEY)=/gmu)].map((m) => m[1])
  expect(keys, '.env.example must name exactly one provider key as the default').toHaveLength(1)
  return keys[0] as string
}

/**
 * Every literal model id a template hands to `.model(...)`, with the file that declares it.
 *
 * Two passes rather than one regex: the argument list is captured first, then the LAST string
 * literal inside it is read — which is the fallback in `process.env.LLM_MODEL ?? '…'`, the value a
 * first run with no environment actually gets. A single pattern spanning both alternatives needs a
 * nested quantifier, and a nested quantifier over untrusted-length input is a ReDoS the linter is
 * right to refuse.
 */
function declaredModels(): { file: string; id: string }[] {
  return everyTemplateFile(TEMPLATES)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/\.model\(([^)]*)\)/gu)]
        .map((m) => /['"]([^'"]+)['"]\s*$/u.exec(m[1] ?? ''))
        .filter((literal): literal is RegExpExecArray => literal !== null)
        .map((literal) => ({ file: relative(TEMPLATES, file), id: literal[1] as string }))
    })
}

/** Prefixes that need no credential — a model on the developer's own machine. */
const KEYLESS_PREFIXES = ['ollama/']

describe('a scaffolded model runs on the key the scaffold asks for (#554)', () => {
  it('every declared model id is prefixed with the gateway whose key .env.example asks for', () => {
    const key = declaredProviderKey()
    // OPENROUTER_API_KEY → `openrouter/`. Derived rather than hardcoded so swapping the default
    // provider updates the expectation with it.
    const expected = `${key.replace(/_API_KEY$/u, '').toLowerCase()}/`

    const models = declaredModels()
    expect(
      models.length,
      'no template declares a model — the extraction regex has rotted',
    ).toBeGreaterThan(0)

    const mismatched = models
      .filter(({ id }) => !KEYLESS_PREFIXES.some((p) => id.startsWith(p)))
      .filter(({ id }) => !id.startsWith(expected))
      .map(({ file, id }) => `${file}: ${id}`)

    expect(
      mismatched,
      `these model ids need a key other than ${key}, which is the only one .env.example asks for`,
    ).toEqual([])
  })

  it('no template still promises that a bare vendor prefix routes through the gateway', () => {
    // The claim that produced the report. It is false — the SDK picks the endpoint from the first
    // segment — and it is the sentence that made the 500 look like a framework defect.
    const offenders = everyTemplateFile(TEMPLATES)
      .filter((f) => /routes it upstream|so OpenRouter routes/iu.test(readFileSync(f, 'utf8')))
      .map((f) => relative(TEMPLATES, f))

    expect(offenders).toEqual([])
  })
})
