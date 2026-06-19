/* eslint-disable security/detect-non-literal-fs-filename -- paths derived from build-time cwd, not user input */
/**
 * Built-in OpenAPI docs — serves Scalar UI at /api/docs and the JSON spec
 * at /api/docs/openapi.json. Zero npm deps (Scalar loaded via CDN).
 *
 * Absorbed from @theokit/plugin-openapi (theokit-plugins sibling repo).
 * Core already emits the spec via vite-plugin/openapi-emit/ — this module
 * adds the runtime serving layer.
 *
 * Security: XSS-safe HTML escaping, CSP header for CDN host, GET-only,
 * 10MB filesize cap, path-traversal defense on specFilePath.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export interface OpenApiDocsOptions {
  /** Path to serve Scalar UI (default: '/api/docs'). */
  docsPath?: string
  /** Path to serve the JSON spec (default: '/api/docs/openapi.json'). */
  openapiJsonPath?: string
  /** Path to the spec file on disk (default: '.theokit/openapi.json'). */
  specFilePath?: string
  /** Page title (default: 'API Reference'). */
  pageTitle?: string
  /** Scalar CDN URL (default: jsdelivr). Must be HTTPS. */
  cdnUrl?: string
}

const MAX_SPEC_BYTES = 10 * 1024 * 1024 // 10MB cap (DoS defense)
const DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'

/**
 * Creates a request handler that serves OpenAPI docs.
 * Returns `null` for non-matching requests (passthrough).
 */
export function createOpenApiHandler(opts: OpenApiDocsOptions = {}) {
  const docsPath = opts.docsPath ?? '/api/docs'
  const jsonPath = opts.openapiJsonPath ?? '/api/docs/openapi.json'
  const rawSpecFile = opts.specFilePath ?? '.theokit/openapi.json'
  const title = opts.pageTitle ?? 'API Reference'
  const cdn = opts.cdnUrl ?? DEFAULT_CDN

  // Path-traversal defense — validate the RAW input, BEFORE resolve().
  // resolve() normalizes `..` away (e.g. '../../../etc/passwd' becomes an
  // absolute path with no '..' left), so checking the resolved string is a
  // dead guard. Reject any `..` path segment in the input instead; absolute
  // paths without traversal segments stay allowed.
  if (hasDotDotSegment(rawSpecFile)) {
    throw new Error(`[theokit:openapi] specFilePath must not contain ".." segments: ${rawSpecFile}`)
  }
  const specFile = resolve(rawSpecFile)

  return (request: Request): Response | null => {
    if (request.method !== 'GET') return null

    const url = new URL(request.url)

    if (url.pathname === docsPath) {
      const cdnHost = new URL(cdn).host
      return new Response(renderScalarHtml(title, jsonPath, cdn), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `script-src 'self' 'unsafe-eval' ${cdnHost}; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${cdnHost}; font-src 'self' data: ${cdnHost}; connect-src 'self' ${cdnHost}`,
        },
      })
    }

    if (url.pathname === jsonPath) {
      return serveSpecFile(specFile)
    }

    return null
  }
}

/** True if the raw path contains a `..` segment (POSIX `/` or Windows `\` separator). */
function hasDotDotSegment(p: string): boolean {
  return p.split(/[/\\]/).includes('..')
}

// ── HTML renderer ──

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderScalarHtml(title: string, specUrl: string, cdnUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body>
  <script id="api-reference" data-url="${escapeHtml(specUrl)}"></script>
  <script src="${escapeHtml(cdnUrl)}"></script>
</body>
</html>`
}

// ── Spec file server ──

function serveSpecFile(filePath: string): Response {
  if (!existsSync(filePath)) {
    return jsonResponse(503, {
      error: {
        code: 'OPENAPI_NOT_EMITTED',
        message: 'OpenAPI spec not generated yet. Start the dev server and visit a route first.',
      },
    })
  }

  try {
    const stat = statSync(filePath)
    if (stat.size > MAX_SPEC_BYTES) {
      return jsonResponse(413, {
        error: {
          code: 'OPENAPI_TOO_LARGE',
          message: `Spec file exceeds ${MAX_SPEC_BYTES / 1024 / 1024}MB limit`,
        },
      })
    }

    const content = readFileSync(filePath, 'utf-8')
    return new Response(content, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read OpenAPI spec file'
    return jsonResponse(500, {
      error: { code: 'OPENAPI_READ_FAILED', message },
    })
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
