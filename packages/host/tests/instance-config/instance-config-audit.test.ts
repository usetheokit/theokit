import {
  mkdtempSync,
  writeFileSync,
  statSync,
  mkdirSync,
  readdirSync,
  chmodSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineInstanceConfig, InstanceConfigError } from '../../src/instance-config/index.js'
const mk = () => mkdtempSync(join(tmpdir(), 'ic-'))
const cfg = defineInstanceConfig({
  app: 'demo',
  keys: {
    DEMO_A: {},
    DEMO_B: {
      parse: (r) => {
        if (r === 'bad') throw new Error('x')
        return r
      },
    },
  },
})

describe.runIf(process.platform !== 'win32')('audit', () => {
  it('finds and fixes file and own directory modes', () => {
    const d = mk()
    const dir = join(d, 'demo')
    mkdirSync(dir)
    const f = join(dir, 'demo.env')
    writeFileSync(f, 'DEMO_A="x"\n')
    chmodSync(f, 0o644)
    chmodSync(dir, 0o755)
    const findings = cfg.audit(f)
    expect(findings.map((x) => x.id)).toEqual(['file-mode', 'directory-mode'])
    expect(cfg.fix(findings)).toHaveLength(2)
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(cfg.audit(f)).toEqual([])
  })
  it('leaves a foreign directory alone', () => {
    const d = mk()
    const f = join(d, 'c.env')
    writeFileSync(f, '')
    chmodSync(f, 0o600)
    chmodSync(d, 0o755)
    expect(cfg.audit(f)).toEqual([])
  })
})
