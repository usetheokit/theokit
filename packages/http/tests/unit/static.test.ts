import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getMimeType, isSafePath, createStaticHandler } from '../../src/static.js'

// ── MIME type detection ────────────────────────────────

describe('getMimeType', () => {
  it('test_get_mime_type_css', () => {
    expect(getMimeType('styles/globals.css')).toBe('text/css; charset=utf-8')
  })

  it('test_get_mime_type_js', () => {
    expect(getMimeType('client.js')).toBe('text/javascript; charset=utf-8')
  })

  it('test_get_mime_type_png', () => {
    expect(getMimeType('logo.png')).toBe('image/png')
  })

  it('test_get_mime_type_woff2', () => {
    expect(getMimeType('font.woff2')).toBe('font/woff2')
  })

  it('test_get_mime_type_unknown', () => {
    expect(getMimeType('data.xyz')).toBe('application/octet-stream')
  })
})

// ── Path safety ────────────────────────────────────────

describe('isSafePath', () => {
  it('test_safe_path_blocks_traversal', () => {
    expect(isSafePath('../etc/passwd')).toBe(false)
    expect(isSafePath('/foo/../../etc/passwd')).toBe(false)
    expect(isSafePath('/foo/..')).toBe(false)
  })

  it('test_safe_path_blocks_double_slash', () => {
    expect(isSafePath('//etc/passwd')).toBe(false)
    expect(isSafePath('/foo//bar')).toBe(false)
  })

  it('test_safe_path_allows_normal', () => {
    expect(isSafePath('/globals.css')).toBe(true)
    expect(isSafePath('/images/logo.png')).toBe(true)
    expect(isSafePath('/favicon.ico')).toBe(true)
  })
})

// ── Static handler (integration with temp dir) ────────

describe('createStaticHandler', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('test_handler_serves_existing_file', async () => {
    // Arrange
    tempDir = mkdtempSync(join(tmpdir(), 'theokit-static-'))
    writeFileSync(join(tempDir, 'hello.txt'), 'Hello, TheoKit!')
    const handler = createStaticHandler({ root: tempDir })

    // Act
    const request = new Request('http://localhost:3000/hello.txt')
    const response = await handler(request)

    // Assert
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const body = await response!.text()
    expect(body).toBe('Hello, TheoKit!')
  })

  it('test_handler_returns_null_for_missing', async () => {
    // Arrange
    tempDir = mkdtempSync(join(tmpdir(), 'theokit-static-'))
    const handler = createStaticHandler({ root: tempDir })

    // Act
    const request = new Request('http://localhost:3000/does-not-exist.css')
    const response = await handler(request)

    // Assert
    expect(response).toBeNull()
  })

  it('test_handler_skips_api_routes', async () => {
    // Arrange
    tempDir = mkdtempSync(join(tmpdir(), 'theokit-static-'))
    const handler = createStaticHandler({ root: tempDir })

    // Act
    const request = new Request('http://localhost:3000/api/tasks')
    const response = await handler(request)

    // Assert
    expect(response).toBeNull()
  })

  it('test_handler_skips_non_get', async () => {
    // Arrange
    tempDir = mkdtempSync(join(tmpdir(), 'theokit-static-'))
    writeFileSync(join(tempDir, 'data.json'), '{}')
    const handler = createStaticHandler({ root: tempDir })

    // Act
    const request = new Request('http://localhost:3000/data.json', { method: 'POST' })
    const response = await handler(request)

    // Assert
    expect(response).toBeNull()
  })
})
