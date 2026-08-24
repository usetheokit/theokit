import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { serveStaticFile } from '../../packages/theo/src/server/http/static.js'

/**
 * Direct unit tests for `serveStaticFile` — exercises the branches not
 * reached by integration tests:
 *   - path-traversal 403
 *   - missing file (returns false)
 *   - directory-as-path (stat.isFile() === false → returns false)
 *   - unknown extension → application/octet-stream fallback
 */

function makeMockRes() {
  const chunks: Buffer[] = []
  let statusCode = 200
  const headers: Record<string, string | number | string[]> = {}
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk))
      cb()
    },
  })
  // Mimic ServerResponse's writeHead / end shape.
  ;(stream as unknown as ServerResponse).writeHead = ((
    status: number,
    h?: Record<string, string | number>,
  ) => {
    statusCode = status
    if (h) Object.assign(headers, h)
    return stream as unknown as ServerResponse
  }) as ServerResponse['writeHead']
  ;(stream as unknown as ServerResponse).setHeader = (
    name: string,
    value: string | number | string[],
  ) => {
    headers[name] = value
    return stream as unknown as ServerResponse
  }
  ;(stream as unknown as ServerResponse).getHeader = (name: string) => headers[name]
  return {
    res: stream as unknown as ServerResponse,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getBody: () => Buffer.concat(chunks),
  }
}

function makeMockReq(url: string): IncomingMessage {
  return { url, method: 'GET', headers: {} } as IncomingMessage
}

describe('serveStaticFile', () => {
  let clientDir: string
  // `clientDir` is itself the mkdtemp root in this suite, so the escape target needs a root of its
  // own — a sibling the server was never pointed at.
  let escapeRoot: string

  beforeAll(() => {
    escapeRoot = mkdtempSync(join(tmpdir(), 'serve-static-outside-'))
    writeFileSync(join(escapeRoot, 'secret.txt'), 'TOP-SECRET-OUTSIDE-CLIENTDIR')
    clientDir = mkdtempSync(join(tmpdir(), 'serve-static-'))
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>x</title>')
    writeFileSync(join(clientDir, 'app.unknownext'), 'raw bytes')
    mkdirSync(join(clientDir, 'subdir'))
    symlinkSync(join(escapeRoot, 'secret.txt'), join(clientDir, 'leak.txt'))
    symlinkSync(join(clientDir, 'index.html'), join(clientDir, 'alias.html'))
  })

  afterAll(() => {
    rmSync(clientDir, { recursive: true, force: true })
    rmSync(escapeRoot, { recursive: true, force: true })
  })

  it('Given a known extension, Then serves with correct MIME', () => {
    const { res, getStatus, getHeaders } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/index.html'), res, clientDir)
    expect(handled).toBe(true)
    expect(getStatus()).toBe(200)
    expect(getHeaders()['Content-Type']).toBe('text/html')
  })

  it('Given an unknown extension, Then falls back to application/octet-stream', () => {
    const { res, getStatus, getHeaders } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/app.unknownext'), res, clientDir)
    expect(handled).toBe(true)
    expect(getStatus()).toBe(200)
    expect(getHeaders()['Content-Type']).toBe('application/octet-stream')
  })

  it('Given a missing file, Then returns false without writing the response', () => {
    const { res, getBody } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/does-not-exist.css'), res, clientDir)
    expect(handled).toBe(false)
    expect(getBody().byteLength).toBe(0)
  })

  // #428 — the traversal guard compares strings that `path.resolve` produced, and `resolve` never
  // touches the disk. A symlink is exactly the case where the path and the file disagree, so the
  // guard passes and the read leaves the directory the server was told to serve.
  it('Given a symlink pointing outside clientDir, Then refuses to serve its target', () => {
    const outside = join(escapeRoot, 'secret.txt')
    const { res, getBody } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/leak.txt'), res, clientDir)
    expect(handled).toBe(false)
    expect(getBody().toString()).not.toContain('TOP-SECRET')
    expect(outside).toBeTruthy()
  })

  // The containment fix must not outlaw symlinks as such — only the ones that leave. A build step
  // that links one asset to another inside the served tree is ordinary and must keep working.
  it('Given a symlink whose target stays inside clientDir, Then serves it', () => {
    const { res, getStatus, getBody } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/alias.html'), res, clientDir)
    expect(handled).toBe(true)
    expect(getStatus()).toBe(200)
    expect(getBody().toString()).toContain('<title>x</title>')
  })

  it('Given a directory path, Then returns false (not a regular file)', () => {
    const { res, getBody } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/subdir'), res, clientDir)
    expect(handled).toBe(false)
    expect(getBody().byteLength).toBe(0)
  })

  it('Given a path-traversal attempt, Then responds 403 and stops processing', () => {
    const { res, getStatus, getBody } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/../../../etc/passwd'), res, clientDir)
    expect(handled).toBe(true)
    expect(getStatus()).toBe(403)
    expect(getBody().toString()).toBe('Forbidden')
  })

  it('Given a URL with query string, Then strips the query before resolving', () => {
    const { res, getStatus, getHeaders } = makeMockRes()
    const handled = serveStaticFile(makeMockReq('/index.html?v=42'), res, clientDir)
    expect(handled).toBe(true)
    expect(getStatus()).toBe(200)
    expect(getHeaders()['Content-Type']).toBe('text/html')
  })

  it('Given req.url is undefined, Then resolves to the client root', () => {
    const { res } = makeMockRes()
    // root resolves to a directory which is not a file — returns false
    const req = { url: undefined, method: 'GET', headers: {} } as unknown as IncomingMessage
    const handled = serveStaticFile(req, res, clientDir)
    expect(handled).toBe(false)
  })
})
