/** OC-72: `theoclaw skills search <term>` asks the skills registry which skills match. */

export interface RegistrySkill {
  readonly name: string
  readonly description: string
  readonly latest: string
  readonly versions: readonly string[]
}

export class RegistryError extends Error {}

export interface SearchOptions {
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

const TIMEOUT_MS = 10_000
const MAX_BYTES = 1_000_000

/** `https://` anywhere, `http://` only for loopback hosts. */
export function checkRegistryBase(base: string): URL {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new RegistryError(`THEOCLAW_SKILLS_REGISTRY is not a URL: ${base}`)
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new RegistryError(
      'THEOCLAW_SKILLS_REGISTRY must be an https:// URL (http:// only for loopback hosts)',
    )
  return url
}

function isSkill(value: unknown): value is RegistrySkill {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.name === 'string' &&
    typeof s.description === 'string' &&
    typeof s.latest === 'string' &&
    Array.isArray(s.versions) &&
    s.versions.every((v) => typeof v === 'string')
  )
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RegistryError('the skills registry response is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function searchSkills(
  base: string,
  term: string,
  options: SearchOptions = {},
): Promise<RegistrySkill[]> {
  const root = checkRegistryBase(base)
  const url = `${root.href.replace(/\/+$/, '')}/v1/skills?q=${encodeURIComponent(term)}`
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    })
  } catch {
    throw new RegistryError(`cannot reach the skills registry at ${base}`)
  }
  if (!response.ok) throw new RegistryError(`the skills registry answered ${response.status}`)
  let body: unknown
  try {
    body = JSON.parse(await readCapped(response, options.maxBytes ?? MAX_BYTES))
  } catch (error) {
    if (error instanceof RegistryError) throw error
    throw new RegistryError('the skills registry answered something that is not JSON')
  }
  const skills = (body as { skills?: unknown } | null)?.skills
  if (!Array.isArray(skills) || !skills.every(isSkill))
    throw new RegistryError('the skills registry answered an unexpected shape')
  return skills
}
