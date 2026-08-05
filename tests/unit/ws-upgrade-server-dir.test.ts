/**
 * theokit#95 — o `serverDir` configurado tem de valer também para o scan de WebSocket do dev.
 *
 * O #95 foi corrigido no route-serving, no typed-client, nas actions e no HMR, mas
 * `vite-plugin/ws-upgrade.ts` continuou resolvendo `resolve(projectRoot, 'server')`. Num projeto
 * com `serverDir: 'core'`, as rotas HTTP passaram a ser encontradas e as de WebSocket não — o que
 * é pior do que a falha original, porque a correção parcial faz parecer que a opção funciona.
 *
 * O teste observa o COMPORTAMENTO, não a string: com rotas encontradas, o handler de `upgrade` é
 * anexado ao httpServer; sem rotas, a função sai antes e nada é anexado. Assertar o caminho passado
 * ao scanner testaria a implementação e continuaria verde se o scanner mudasse de contrato.
 *
 * O `on('upgrade')` acontece DENTRO de um `import('ws')` dinâmico (lazy, para app sem WebSocket não
 * pagar o custo), então a asserção positiva precisa de `vi.waitFor`. A negativa não: a saída
 * antecipada é síncrona, e um `waitFor` ali só esconderia uma anexação tardia.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { setupWsUpgrade } from '../../packages/theo/src/vite-plugin/ws-upgrade.js'

/** Projeto com o backend em `core/` (não no `server/` canônico) e uma rota `ws/echo.ts`. */
function projectWithBackendIn(dirName: string): { projectRoot: string; serverDir: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'theokit-95-'))
  const serverDir = join(projectRoot, dirName)
  mkdirSync(join(serverDir, 'ws'), { recursive: true })
  writeFileSync(join(serverDir, 'ws', 'echo.ts'), 'export default {}\n')
  return { projectRoot, serverDir }
}

function fakeViteServer(): { httpServer: { on: ReturnType<typeof vi.fn> } } {
  return { httpServer: { on: vi.fn() } }
}

describe('setupWsUpgrade honra o serverDir configurado (#95)', () => {
  it('anexa o handler de upgrade quando as rotas ws vivem no serverDir configurado', async () => {
    const { serverDir } = projectWithBackendIn('core')
    const server = fakeViteServer()

    setupWsUpgrade(server as never, serverDir)

    await vi.waitFor(() =>
      expect(server.httpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function)),
    )
  })

  it('não anexa nada quando o serverDir não tem rotas ws — a saída antecipada continua valendo', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'theokit-95-vazio-'))
    const server = fakeViteServer()

    setupWsUpgrade(server as never, join(projectRoot, 'core'))

    expect(server.httpServer.on).not.toHaveBeenCalled()
  })

  it('o layout canônico `server/` segue funcionando — a correção amplia, não substitui', async () => {
    const { serverDir } = projectWithBackendIn('server')
    const server = fakeViteServer()

    setupWsUpgrade(server as never, serverDir)

    await vi.waitFor(() =>
      expect(server.httpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function)),
    )
  })
})
