/* eslint-disable security/detect-non-literal-fs-filename --
 * Static-file server. The URL path IS user-controlled, so every fs call here is guarded twice
 * before it runs: a string check that rejects a URL walking out with `..` (403), and then a
 * `realpath` check that asks the filesystem whether the target actually lives under `clientDir`.
 *
 * The second guard is not decoration. This header used to claim the string check alone was
 * authoritative, and #428 disproved it: `path.resolve` never touches the disk, so a symlink inside
 * `clientDir` sailed through it and the server returned a file from anywhere on the host. Both
 * guards are now required for that claim to hold.
 */
import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve, extname, sep } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.map': 'application/json',
}

export function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  clientDir: string,
): boolean {
  const urlPath = (req.url ?? '/').split('?')[0]

  // Path traversal prevention (EC-1) — rejects a URL that walks out with `..`.
  // `sep` matters: without it `/srv/client-backup` passes as "inside" `/srv/client`.
  const filePath = resolve(clientDir, '.' + urlPath)
  if (filePath !== clientDir && !filePath.startsWith(clientDir + sep)) {
    res.writeHead(403)
    res.end('Forbidden')
    return true
  }

  // #428 — the check above is string arithmetic; `resolve` never touches the disk, so it cannot
  // see that an entry inside `clientDir` IS a file somewhere else. Ask the filesystem instead.
  // Symlinks are not banned — one that stays inside the served tree is ordinary and still served;
  // only the ones that leave are refused, and they are refused as "not here" rather than 403 so
  // the response does not confirm what lies outside.
  let realPath: string
  let realRoot: string
  try {
    realPath = realpathSync(filePath)
    realRoot = realpathSync(clientDir)
  } catch {
    return false // missing, unreadable, or a broken link — all "not served"
  }
  if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) return false

  // One descriptor for the type check and the bytes: re-opening by path between them is what
  // lets the file that was checked differ from the file that is served (CodeQL js/file-system-race).
  let fd: number
  try {
    fd = openSync(realPath, 'r')
  } catch {
    return false
  }
  try {
    if (!fstatSync(fd).isFile()) return false

    const ext = extname(filePath)
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
    const content = readFileSync(fd)

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
    })
    res.end(content)
    return true
  } finally {
    closeSync(fd)
  }
}
