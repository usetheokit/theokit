/**
 * B-051 — every failure of `readImageAttachment` is the declared typed error.
 *
 * The function declares an `ImageAttachError` contract with codes (`not_found`, `too_large`,
 * `unsupported`) and had one path that escaped it: `readFileSync` runs AFTER `statSync` succeeded,
 * and it can still fail — EACCES on a file you may stat but not read, EISDIR, EMFILE. A caller
 * written against the contract catches `ImageAttachError` and lets that one through.
 *
 * A contract that holds on most paths is a contract callers will trust on all of them.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ImageAttachError, readImageAttachment } from '../../src/context/image-attach.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theocode-img-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('B-051 — the typed-error contract holds on every path', () => {
  it('test_a_readable_image_is_attached', () => {
    // Anti-vacuity floor: throwing on everything would satisfy the assertions below.
    const path = join(dir, 'a.png')
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    expect(readImageAttachment(path).mimeType).toBe('image/png')
  })

  it('test_a_missing_file_is_the_typed_error', () => {
    expect(() => readImageAttachment(join(dir, 'nope.png'))).toThrow(ImageAttachError)
  })

  it('test_a_directory_named_like_an_image_is_the_typed_error', () => {
    // `statSync` succeeds on a directory, so the size check passes and the READ is what fails —
    // with EISDIR, which used to leave this function as an untyped Error.
    const path = join(dir, 'looks-like.png')
    mkdirSync(path)

    expect(
      () => readImageAttachment(path),
      'the read failure escaped the declared ImageAttachError contract',
    ).toThrow(ImageAttachError)
  })

  it('test_an_unreadable_file_is_the_typed_error', () => {
    const path = join(dir, 'locked.png')
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    chmodSync(path, 0o000)

    expect(() => readImageAttachment(path)).toThrow(ImageAttachError)
  })
})
