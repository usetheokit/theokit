import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { runConfigHook } from '../../packages/theo/src/vite-plugin/config-hook.js'

/**
 * #121 — a local SQLite DB (`.data/app.db` + its `-wal`/`-shm` sidecars) is
 * written on every request that touches the DB (agent turns, conversations…).
 * If the Vite dev watcher sees those writes it fires a full page reload — the
 * screen "blinks" and any in-flight agent stream is torn down. The dev config
 * must ignore the DB artifacts + theokit's own `.theokit/` output.
 */
describe('runConfigHook — server.watch.ignored (#121)', () => {
  const cfg = runConfigHook({
    projectRoot: '/tmp/x',
    theoSrcDir: '/tmp/theo',
    services: undefined,
    optimizeDepsInclude: [],
  })
  const ignored = (cfg.server as { watch: { ignored: string[] } }).watch.ignored

  it('ignores the local SQLite data dir + WAL/SHM sidecars (no reload on DB writes)', () => {
    expect(ignored).toContain('**/.data/**')
    expect(ignored.some((p) => p.includes('db-wal'))).toBe(true)
    expect(ignored.some((p) => p.includes('db-shm'))).toBe(true)
  })

  it("ignores theokit's own .theokit output dir (no self-triggered reload)", () => {
    expect(ignored).toContain('**/.theokit/**')
  })

  it('has no duplicate ignore entries', () => {
    expect(new Set(ignored).size).toBe(ignored.length)
  })
})

/**
 * #121, o degrau que faltava: os ignores têm de CHEGAR ao watcher.
 *
 * O teste acima prova que `runConfigHook` produz a lista. Não prova que ela sobrevive —
 * `cli/commands/dev.ts` chama `createServer({ server: { ... } })`, e a config inline tem
 * precedência sobre a do plugin. Hoje ela não declara `watch`, então o merge do Vite preserva o
 * do plugin. No dia em que alguém adicionar um `watch` ali, a correção some **em silêncio**: o
 * único sintoma é a tela voltar a piscar, e o teste acima continua verde.
 *
 * A checagem é sobre a FONTE porque é ali que a regressão nasceria. Tentei fazê-la mesclando as
 * duas configs com o `mergeConfig` do próprio Vite — mais fiel — mas `vite` não é resolvível a
 * partir do diretório de testes da raiz neste workspace pnpm, e cravar o caminho profundo
 * (`packages/theo/node_modules/vite`) seria trocar uma fragilidade por outra.
 */
describe('dev.ts must not overwrite the watch of the plugin (#121)', () => {
  it('the inline config of createServer does not declare server.watch', () => {
    const source = readFileSync(
      resolve(__dirname, '../../packages/theo/src/cli/commands/dev.ts'),
      'utf-8',
    )
    const call = source.slice(source.indexOf('server = await createServer({'))
    const serverBlock = call.slice(call.indexOf('server: {'), call.indexOf('logLevel:'))

    expect(serverBlock).not.toMatch(/\bwatch\s*:/)
  })
})
