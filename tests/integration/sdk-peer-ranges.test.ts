/**
 * M48 (ecosystem-integration-guarantee) T3.1 — the SDK-family version ranges are CLOSED and
 * aligned to the framework's v4 floor. Guards the drift discovered during discovery: the root
 * devDep pinned a stale `^3.5.0` (so root-level tests resolved 3.5.0, not the framework's 4.0.2)
 * and the `@theokit/sdk-tools` peer was left open (`>=0.11.0`). A closed range is the install-time
 * half of the seam guarantee (the boot check + contract test are the runtime half).
 *
 * ## Reescrito (backlog B-M67-01, item 6)
 *
 * `test_sdk_tools_peer_is_closed_caret` exigia `peerDependencies['@theokit/sdk-tools'] === '^0.11.0'`.
 * Duas coisas mudaram desde então e nenhuma foi refletida aqui: o pacote saiu de peer opcional para
 * **dependency** (o subpath `@theokit/agents/tools` faz `export *` estático dele — um peer opcional
 * ausente quebraria o import), e a linha andou 15 minors. O guarda ficou vermelho por default, e um
 * guarda permanentemente vermelho treina o time a ignorar vermelho.
 *
 * A propriedade que ele sempre quis expressar não é o literal: é que **nenhum range da família SDK
 * fica aberto** e que o manifest não mente sobre onde a dependência vive. Esta versão afirma isso, e
 * acrescenta a lente que faltava — `peerDependenciesMeta` sem `peerDependencies` correspondente é
 * metadata inerte, uma declaração de opcionalidade que o npm nunca lê.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readPkg = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, unknown>

/** Um range é fechado quando tem teto: caret/til, ou um `<`/`<=` explícito. */
function isClosed(range: string): boolean {
  if (/^[\^~]/.test(range)) return true
  return /<=?\s*\d/.test(range)
}

const MANIFESTS = ['packages/theo/package.json', 'packages/agents/package.json'] as const
const BUCKETS = ['dependencies', 'peerDependencies'] as const

describe('SDK-family peer/version ranges are closed + aligned (M48 T3.1)', () => {
  it('test_no_open_sdk_family_range_remains', () => {
    // Um `>=0.11.0` sem teto deixa o consumidor herdar uma major nova sem revisão — foi o defeito
    // original do M48, e ele vale para `dependencies` tanto quanto para `peerDependencies`.
    for (const manifest of MANIFESTS) {
      const pkg = readPkg(manifest)
      for (const bucket of BUCKETS) {
        const entries = (pkg[bucket] ?? {}) as Record<string, string>
        for (const [name, range] of Object.entries(entries)) {
          if (!name.startsWith('@theokit/sdk')) continue
          expect(isClosed(range), `${manifest} § ${bucket} declares an open ${name}=${range}`).toBe(
            true,
          )
        }
      }
    }
  })

  it('test_the_sdk_family_lives_in_exactly_one_bucket_per_manifest', () => {
    // Declarar o mesmo pacote em `dependencies` e `devDependencies` com ranges DIFERENTES é o modo
    // de falha que o ADR 0062 documentou no presenter: a suíte roda contra uma versão e o consumidor
    // instala outra, e a divergência só aparece em produção.
    for (const manifest of MANIFESTS) {
      const pkg = readPkg(manifest)
      const seen = new Map<string, { bucket: string; range: string }>()
      for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
        for (const [name, range] of Object.entries((pkg[bucket] ?? {}) as Record<string, string>)) {
          if (!name.startsWith('@theokit/sdk')) continue
          const prior = seen.get(name)
          if (prior !== undefined && prior.range !== range) {
            expect.fail(
              `${manifest} declares ${name} twice with different ranges: ` +
                `${prior.bucket}=${prior.range} vs ${bucket}=${range}`,
            )
          }
          seen.set(name, { bucket, range })
        }
      }
    }
  })

  it('test_every_peer_meta_entry_has_a_matching_peer', () => {
    // `peerDependenciesMeta` só qualifica um peer existente. Uma entrada órfã não torna nada
    // opcional — ela apenas afirma, no manifest publicado, um contrato que o npm nunca lê.
    for (const manifest of MANIFESTS) {
      const pkg = readPkg(manifest)
      const peers = (pkg.peerDependencies ?? {}) as Record<string, string>
      const meta = (pkg.peerDependenciesMeta ?? {}) as Record<string, unknown>
      for (const name of Object.keys(meta)) {
        expect(
          Object.hasOwn(peers, name),
          `${manifest} marks ${name} optional in peerDependenciesMeta but declares no such peer`,
        ).toBe(true)
      }
    }
  })

  it('test_root_devdep_sdk_aligned_to_v4_line', () => {
    // The root devDep must track the v4 line (not the stale `^3.5.0` hoist EC-C fixed). Assert the
    // v4 caret prefix, NOT an exact pin, so a within-v4 bump (4.0 → 4.1 → 4.2) stays green — only a
    // drop off v4 (or back to a 3.x hoist) fails here.
    const root = readPkg('package.json')
    const dev = root.devDependencies as Record<string, string>
    expect(dev['@theokit/sdk']).toMatch(/^\^4\./)
  })

  it('test_isClosed_rejects_the_open_shapes', () => {
    // Lente negativa sobre o oráculo: se `isClosed` aceitasse tudo, os dois primeiros testes
    // ficariam verdes sem provar nada.
    for (const open of ['>=0.11.0', '>0.11.0', '*', 'latest', '']) {
      expect(isClosed(open), `deveria recusar "${open}"`).toBe(false)
    }
    for (const closed of ['^0.26.1', '~1.2.3', '>=0.2.0 <1.0.0', '>=1 <=2']) {
      expect(isClosed(closed), `deveria aceitar "${closed}"`).toBe(true)
    }
  })
})
