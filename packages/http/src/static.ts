/**
 * Static file handler — runtime-agnostic (Node/Bun/Deno).
 *
 * Serves files from a root directory (default: `public/`).
 * Derived from Hono's serve-static middleware pattern:
 *   - MIME type detection from extension
 *   - Path traversal prevention via regex guard
 *   - Runtime-agnostic file reading (Bun.file / Deno.readFile / node:fs)
 */

// ── MIME type map (50+ types) ──────────────────────────

const MIME_TYPES: Record<string, string> = {
  // Text
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.ts': 'text/typescript; charset=utf-8',
  '.tsx': 'text/tsx; charset=utf-8',
  '.jsx': 'text/jsx; charset=utf-8',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Media
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',

  // Documents
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.wasm': 'application/wasm',

  // Misc
  '.map': 'application/json; charset=utf-8',
  '.jsonld': 'application/ld+json; charset=utf-8',
  '.manifest': 'application/manifest+json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

// ── Path traversal guard (Hono-derived regex) ──────────

/**
 * Regex that catches path traversal attacks:
 * - `..` segments (beginning, middle, or end of path)
 * - Double slashes `//`
 * - Backslash sequences `\\`
 */
const UNSAFE_PATH_RE = /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}/

// ── Public API ─────────────────────────────────────────

export interface StaticOptions {
  /** Root directory to serve from (default: 'public'). */
  root?: string
  /** Cache-Control max-age in seconds (default: 0 — no caching). */
  maxAge?: number
}

/**
 * Returns the MIME type for a given file path based on its extension.
 * Falls back to 'application/octet-stream' for unknown extensions.
 */
export function getMimeType(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  const ext = filePath.slice(dot).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

/**
 * Returns true when the path is safe (no traversal, no double slashes).
 */
export function isSafePath(pathname: string): boolean {
  return !UNSAFE_PATH_RE.test(pathname)
}

// ── Runtime-agnostic file reader ───────────────────────

interface FileResult {
  content: Uint8Array
  size: number
}

async function readFileBun(fullPath: string): Promise<FileResult | null> {
  const g = globalThis as Record<string, unknown>
  const BunRT = g.Bun as {
    file: (path: string) => {
      exists: () => Promise<boolean>
      arrayBuffer: () => Promise<ArrayBuffer>
      size: number
    }
  }
  const file = BunRT.file(fullPath)
  if (!(await file.exists())) return null
  const buf = await file.arrayBuffer()
  return { content: new Uint8Array(buf), size: file.size }
}

async function readFileDeno(fullPath: string): Promise<FileResult | null> {
  const g = globalThis as Record<string, unknown>
  const DenoRT = g.Deno as {
    readFile: (path: string) => Promise<Uint8Array>
    stat: (path: string) => Promise<{ isDirectory: boolean }>
  }
  try {
    const stat = await DenoRT.stat(fullPath)
    if (stat.isDirectory) return null
    const content = await DenoRT.readFile(fullPath)
    return { content, size: content.byteLength }
  } catch {
    return null
  }
}

async function readFileNode(fullPath: string): Promise<FileResult | null> {
  try {
    const fs = await import('node:fs/promises')
    const stat = await fs.stat(fullPath)
    if (stat.isDirectory()) return null
    const content = await fs.readFile(fullPath)
    return { content: new Uint8Array(content), size: stat.size }
  } catch {
    return null
  }
}

async function readFile(fullPath: string): Promise<FileResult | null> {
  const g = globalThis as Record<string, unknown>
  if (g.Bun) return readFileBun(fullPath)
  if (g.Deno) return readFileDeno(fullPath)
  return readFileNode(fullPath)
}

// ── Resolve root to absolute path ──────────────────────

async function resolveRoot(root: string): Promise<string> {
  const g = globalThis as Record<string, unknown>
  if (g.Deno) {
    const DenoRT = g.Deno as { cwd: () => string }
    const { join } = await import('node:path')
    return join(DenoRT.cwd(), root)
  }
  const { resolve } = await import('node:path')
  return resolve(root)
}

// ── Factory ────────────────────────────────────────────

/**
 * Creates a static file handler that serves files from `root` directory.
 *
 * Returns `null` when the request does not match a static file (allowing
 * the caller to fall through to the next handler).
 */
export function createStaticHandler(
  options?: StaticOptions,
): (request: Request) => Promise<Response | null> {
  const root = options?.root ?? 'public'
  const maxAge = options?.maxAge ?? 0

  let resolvedRoot: string | undefined

  return async (request: Request): Promise<Response | null> => {
    // Only serve GET and HEAD
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return null

    // Extract pathname, strip query params
    const url = new URL(request.url)
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return null // Malformed URL encoding
    }

    // Skip framework-reserved paths
    if (pathname.startsWith('/api/') || pathname.startsWith('/@theo/')) return null

    // Path traversal guard
    if (!isSafePath(pathname)) return null

    // Lazy-resolve root to absolute path (once per handler lifetime)
    resolvedRoot ??= await resolveRoot(root)

    // Build full file path
    const { join } = await import('node:path')
    let fullPath = join(resolvedRoot, pathname)

    // Directory → try index.html
    let result = await readFile(fullPath)
    if (!result && (pathname.endsWith('/') || !pathname.includes('.'))) {
      fullPath = join(fullPath, 'index.html')
      result = await readFile(fullPath)
    }

    if (!result) return null

    // Build response headers
    const contentType = getMimeType(fullPath)
    const headers: Record<string, string> = {
      'content-type': contentType,
      'content-length': String(result.size),
    }
    if (maxAge > 0) {
      headers['cache-control'] = `public, max-age=${String(maxAge)}`
    }

    // HEAD: headers only, no body
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }

    return new Response(result.content as unknown as BodyInit, { status: 200, headers })
  }
}
