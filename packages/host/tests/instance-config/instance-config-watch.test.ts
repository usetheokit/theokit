import { mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineInstanceConfig, type ReloadEvent } from '../../src/instance-config/index.js'

const SECRET = 'distinctive-value-77c1'
const cfg = defineInstanceConfig({
  app: 'demo',
  keys: { DEMO_HOT: { hot: true }, DEMO_COLD: {} },
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const replace = (dir: string, f: string, text: string) => {
  writeFileSync(join(dir, 'tmp.env'), text)
  renameSync(join(dir, 'tmp.env'), f)
}
const setup = (validate?: (c: Readonly<NodeJS.ProcessEnv>) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'icw-'))
  const f = join(dir, 'c.env')
  writeFileSync(f, 'DEMO_HOT=old\n')
  const env: NodeJS.ProcessEnv = { DEMO_HOT: 'old' }
  const events: ReloadEvent[] = []
  const w = cfg.watch(f, env, {
    debounceMs: 30,
    validate,
    onEvent: (e) => events.push(e),
  })
  return { dir, f, env, events, w }
}

describe('watch', () => {
  it('reports one applied event after a rename-over, then stops on close', async () => {
    const { dir, f, env, events, w } = setup()
    replace(dir, f, `DEMO_HOT=${SECRET}\nDEMO_COLD=${SECRET}\n`)
    await sleep(300)
    expect(events).toEqual([
      { kind: 'applied', applied: ['DEMO_HOT'], restartRequired: ['DEMO_COLD'] },
    ])
    expect(env.DEMO_HOT).toBe(SECRET)
    expect(JSON.stringify(events)).not.toContain(SECRET)
    w.close()
    replace(dir, f, 'DEMO_HOT=again\n')
    await sleep(200)
    expect(events).toHaveLength(1)
  })
  it('reports refused when validate throws', async () => {
    const { dir, f, env, events, w } = setup(() => {
      throw new Error(SECRET)
    })
    replace(dir, f, `DEMO_HOT=${SECRET}\n`)
    await sleep(300)
    w.close()
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('refused')
    expect(env.DEMO_HOT).toBe('old')
    expect(JSON.stringify(events)).not.toContain(SECRET)
  })
  it('reports watch-failed when the directory is missing', () => {
    const events: ReloadEvent[] = []
    cfg.watch(join(tmpdir(), 'icw-missing-dir', 'c.env'), {}, { onEvent: (e) => events.push(e) })
    expect(events[0]?.kind).toBe('watch-failed')
  })
})
