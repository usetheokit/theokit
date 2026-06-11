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

  it('should parse --backend python (space-separated)', () => {
    expect(parseBackendFlags(['--backend', 'python'])).toEqual(['python'])
  })

  it('should parse --backend=python (equals-separated)', () => {
    expect(parseBackendFlags(['--backend=python'])).toEqual(['python'])
  })

  it('should parse --backend=node', () => {
    expect(parseBackendFlags(['--backend=node'])).toEqual(['node'])
  })

  it('should parse multiple --backend flags', () => {
    const result = parseBackendFlags(['--backend', 'python', '--backend', 'node'])
    expect(result).toEqual(['python', 'node'])
  })

  it('should parse mixed formats', () => {
    const result = parseBackendFlags(['--backend=python', '--backend', 'node'])
    expect(result).toEqual(['python', 'node'])
  })

  it('should throw for unknown backend value', () => {
    expect(() => parseBackendFlags(['--backend', 'ruby'])).toThrow(
      /unknown --backend value: 'ruby'/,
    )
  })

  it('should throw for invalid backend with equals format', () => {
    expect(() => parseBackendFlags(['--backend=go'])).toThrow(/unknown --backend value: 'go'/)
  })

  it('should ignore unrelated flags', () => {
    const result = parseBackendFlags(['--yes', '--backend=python', '--template=default', '--bare'])
    expect(result).toEqual(['python'])
  })
})

describe('buildServicesSnippet', () => {
  it('should return empty string for empty selections', () => {
    expect(buildServicesSnippet([])).toBe('')
  })

  it('should build a services snippet for a single backend', () => {
    const snippet = buildServicesSnippet([
      {
        name: 'agent',
        entry: {
          runtime: 'python',
          port: 8001,
          proxy: '/api/agent',
          dev: 'uvicorn main:app --reload --port 8001',
          start: 'uvicorn main:app --port 8001 --workers 4',
        },
      },
    ])

    expect(snippet).toContain("runtime: 'python'")
    expect(snippet).toContain('port: 8001')
    expect(snippet).toContain("proxy: '/api/agent'")
    expect(snippet).toContain('services:')
  })

  it('should build a services snippet for multiple backends', () => {
    const snippet = buildServicesSnippet([
      {
        name: 'agent',
        entry: {
          runtime: 'python',
          port: 8001,
          proxy: '/api/agent',
          dev: 'uvicorn main:app --reload',
          start: 'uvicorn main:app',
        },
      },
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

    expect(snippet).toContain('agent:')
    expect(snippet).toContain('worker:')
    expect(snippet).toContain("runtime: 'python'")
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
    const snippet = `  services: {\n    agent: { runtime: 'python' },\n  },\n`

    const result = injectServicesIntoConfig(source, snippet)

    expect(result).toContain('services:')
    expect(result).toContain("name: 'test'")
    expect(result).toContain("runtime: 'python'")
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
