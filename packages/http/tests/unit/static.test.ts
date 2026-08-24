import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
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

  // #428 — `UNSAFE_PATH_RE` rejects `..` and `//` in the request pathname, but this exploit contains
  // neither: the traversal is in the filesystem, not the URL. The regex cannot see it.
  it('test_handler_refuses_symlink_escaping_root', async () => {
    // Arrange
    tempDir = mkdtempSync(join(tmpdir(), 'theokit-static-'))
    const root = join(tempDir, 'pub')
    mkdirSync(root)
    writeFileSync(join(tempDir, 'secret.txt'), 'HTTP-PKG-SECRET-OUTSIDE-ROOT')
    symlinkSync(join(tempDir, 'secret.txt'), join(root, 'leak.txt'))
    const handler = createStaticHandler({ root })

    // Act
    const response = await handler(new Request('http://localhost:3000/leak.txt'))

    // Assert — unhandled, so the caller falls through to its own 404.
    expect(response).toBeNull()
  })

  // Containment must reject the escape, not symlinks as a feature.
  it('test_handler_serves_symlink_that_stays_inside_root', async () => {
    // Arrange
    tempDir = mkdtempSync(join(tmpdir(), 'theokit-static-'))
    writeFileSync(join(tempDir, 'real.txt'), 'inside the root')
    symlinkSync(join(tempDir, 'real.txt'), join(tempDir, 'alias.txt'))
    const handler = createStaticHandler({ root: tempDir })

    // Act
    const response = await handler(new Request('http://localhost:3000/alias.txt'))

    // Assert
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(await response!.text()).toBe('inside the root')
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
