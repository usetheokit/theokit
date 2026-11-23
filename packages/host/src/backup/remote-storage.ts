import { createWriteStream } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { request } from 'node:https'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { BackupError } from './errors.js'

/** An HTTPS directory: objects live at `<url>/<name>`; GET `<url>/` lists `{ "names": [...] }`. */
export interface RemoteLocation {
  readonly url: string
  /** Sent as `Authorization: Bearer`; never put in an error. */
  readonly token?: string
  /** PEM certificate authorities to trust in addition to the system's (for a private server). */
  readonly ca?: string
  /** Milliseconds a request may stay silent, while connecting, waiting or receiving, before it is abandoned. Default 60000. */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

export function isRemoteRoot(root: string): boolean {
  return /^https:\/\//i.test(root)
}

export function checkRemoteUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BackupError('the storage url is not a valid URL')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new BackupError('a remote storage location needs an https URL without credentials')
  }
}

function objectUrl(location: RemoteLocation, name?: string): URL {
  const base = location.url.endsWith('/') ? location.url : `${location.url}/`
  return new URL(name === undefined ? base : encodeURIComponent(name), base)
}

function send(
  location: RemoteLocation,
  method: 'GET' | 'PUT',
  name: string | undefined,
  headers: Record<string, string>,
  body?: AsyncIterable<Buffer> | Buffer,
): Promise<IncomingMessage> {
  const url = objectUrl(location, name)
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        headers: {
          ...headers,
          ...(location.token === undefined ? {} : { authorization: `Bearer ${location.token}` }),
        },
        ...(location.ca === undefined ? {} : { ca: location.ca }),
        timeout: location.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      resolve,
    )
    req.on('timeout', () => {
      req.destroy(new Error(`no answer within ${location.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`))
    })
    req.on('error', (cause) => {
      reject(new BackupError(`cannot reach the remote storage at ${url.origin}`, { cause }))
    })
    if (body === undefined) req.end()
    else if (Buffer.isBuffer(body)) req.end(body)
    else pipeline(Readable.from(body), req).catch((cause: unknown) => req.destroy(cause as Error))
  })
}

async function readBody(res: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  try {
    for await (const chunk of res) chunks.push(chunk as Buffer)
  } catch (cause) {
    throw new BackupError('the remote storage stopped answering', { cause })
  }
  return Buffer.concat(chunks)
}

function fail(what: string, res: IncomingMessage): BackupError {
  res.resume()
  return new BackupError(`${what}: the server answered ${res.statusCode}`)
}

/** Upload one immutable object; an existing name is refused (`If-None-Match: *`). */
export async function remotePut(
  location: RemoteLocation,
  name: string,
  body: AsyncIterable<Buffer> | Buffer,
): Promise<void> {
  const res = await send(
    location,
    'PUT',
    name,
    { 'if-none-match': '*', 'content-type': 'application/octet-stream' },
    body,
  )
  const status = res.statusCode ?? 0
  if (status < 200 || status >= 300) throw fail(`cannot upload ${name}`, res)
  res.resume()
}

export async function remoteList(location: RemoteLocation): Promise<string[]> {
  const res = await send(location, 'GET', undefined, { accept: 'application/json' })
  if (res.statusCode !== 200) throw fail('cannot list the remote storage', res)
  try {
    const value = JSON.parse((await readBody(res)).toString('utf8')) as { names?: unknown }
    if (!Array.isArray(value.names) || !value.names.every((n) => typeof n === 'string')) {
      throw new Error('bad shape')
    }
    return value.names
  } catch (cause) {
    throw new BackupError('the remote storage listing is not {"names": [...]}', { cause })
  }
}

export async function remoteGet(location: RemoteLocation, name: string): Promise<Buffer> {
  const res = await send(location, 'GET', name, {})
  if (res.statusCode !== 200) throw fail(`cannot download ${name}`, res)
  return readBody(res)
}

export async function remoteDownload(
  location: RemoteLocation,
  name: string,
  file: string,
): Promise<void> {
  const res = await send(location, 'GET', name, {})
  if (res.statusCode !== 200) throw fail(`cannot download ${name}`, res)
  try {
    await pipeline(res, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
  } catch (cause) {
    throw new BackupError(`cannot download ${name}`, { cause })
  }
}
