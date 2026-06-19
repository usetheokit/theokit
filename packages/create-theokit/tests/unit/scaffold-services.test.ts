import { describe, it, expect } from 'vitest'

import {
  parseBackendFlags,
  buildServicesSnippet,
  injectServicesIntoConfig,
  injectHeyApiDep,
} from '../../src/scaffold-services.js'

describe('parseBackendFlags', () => {
  it('should return empty array when no --backend flags', () => {
    expect(parseBackendFlags(['--yes', '--template=default'])).toEqual([])
  })

  it('should parse --backend node (space-separated)', () => {
    expect(parseBackendFlags(['--backend', 'node'])).toEqual(['node'])
  })

  it('should parse --backend=node (equals-separated)', () => {
    expect(parseBackendFlags(['--backend=node'])).toEqual(['node'])
  })

  it('should parse repeated --backend node flags', () => {
    const result = parseBackendFlags(['--backend', 'node', '--backend', 'node'])
    expect(result).toEqual(['node', 'node'])
  })

  it('should throw for unknown backend value', () => {
    expect(() => parseBackendFlags(['--backend', 'ruby'])).toThrow(
      /unknown --backend value: 'ruby'/,
    )
  })

  it('should throw for python (node-only; python deferred)', () => {
    expect(() => parseBackendFlags(['--backend', 'python'])).toThrow(
      /unknown --backend value: 'python'/,
    )
  })

  it('should throw for invalid backend with equals format', () => {
    expect(() => parseBackendFlags(['--backend=go'])).toThrow(/unknown --backend value: 'go'/)
  })

  it('should ignore unrelated flags', () => {
    const result = parseBackendFlags(['--yes', '--backend=node', '--template=default', '--bare'])
    expect(result).toEqual(['node'])
  })
})

describe('buildServicesSnippet', () => {
  it('should return empty string for empty selections', () => {
    expect(buildServicesSnippet([])).toBe('')
  })

  it('should build a services snippet for a single backend', () => {
    const snippet = buildServicesSnippet([
      {
        name: 'worker',
        entry: {
          runtime: 'node',
          port: 8002,
          proxy: '/api/worker',
          dev: 'pnpm dev',
          start: 'pnpm start',
        },
      },
    ])

    expect(snippet).toContain("runtime: 'node'")
    expect(snippet).toContain('port: 8002')
    expect(snippet).toContain("proxy: '/api/worker'")
    expect(snippet).toContain('services:')
  })

  it('should build a services snippet for multiple backends', () => {
    const snippet = buildServicesSnippet([
      {
        name: 'worker',
        entry: {
          runtime: 'node',
          port: 8002,
          proxy: '/api/worker',
          dev: 'pnpm dev',
          start: 'pnpm start',
        },
      },
      {
        name: 'worker2',
        entry: {
          runtime: 'node',
          port: 8003,
          proxy: '/api/worker2',
          dev: 'pnpm dev',
          start: 'pnpm start',
        },
      },
    ])

    expect(snippet).toContain('worker:')
    expect(snippet).toContain('worker2:')
    expect(snippet).toContain("runtime: 'node'")
  })
})

describe('injectServicesIntoConfig', () => {
  it('should return source unchanged when snippet is empty', () => {
    const source = 'defineConfig({ name: "test" })'
    expect(injectServicesIntoConfig(source, '')).toBe(source)
  })

  it('should return source unchanged when services already present', () => {
    const source = 'defineConfig({ services: { agent: {} } })'
    expect(injectServicesIntoConfig(source, '  services: { new: {} }')).toBe(source)
  })

  it('should inject services block into defineConfig', () => {
    const source = `import { defineConfig } from 'theokit'
export default defineConfig({
  name: 'test'
})`
    const snippet = `  services: {\n    worker: { runtime: 'node' },\n  },\n`

    const result = injectServicesIntoConfig(source, snippet)

    expect(result).toContain('services:')
    expect(result).toContain("name: 'test'")
    expect(result).toContain("runtime: 'node'")
  })

  it('should return source unchanged when no defineConfig found', () => {
    const source = 'export default { name: "test" }'
    const snippet = '  services: {}'
    expect(injectServicesIntoConfig(source, snippet)).toBe(source)
  })
})

describe('injectHeyApiDep', () => {
  it('should add @hey-api/client-fetch to dependencies', () => {
    const input = JSON.stringify({ name: 'test', dependencies: { zod: '^3.0.0' } }, null, 2)

    const result = JSON.parse(injectHeyApiDep(input))

    expect(result.dependencies['@hey-api/client-fetch']).toBe('^0.6.0')
    expect(result.dependencies.zod).toBe('^3.0.0')
  })

  it('should not overwrite existing @hey-api/client-fetch', () => {
    const input = JSON.stringify(
      { name: 'test', dependencies: { '@hey-api/client-fetch': '^0.5.0' } },
      null,
      2,
    )

    const result = JSON.parse(injectHeyApiDep(input))

    expect(result.dependencies['@hey-api/client-fetch']).toBe('^0.5.0')
  })

  it('should create dependencies object when missing', () => {
    const input = JSON.stringify({ name: 'test' }, null, 2)

    const result = JSON.parse(injectHeyApiDep(input))

    expect(result.dependencies['@hey-api/client-fetch']).toBe('^0.6.0')
  })
})
