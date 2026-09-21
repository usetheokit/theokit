import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { readDocumentShell } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * B-202. `cloudflare-streaming-shell.test.ts` executes the generated worker against a real
 * `Request` and asserts on the body — a real test of the seam it was written for: an entry
 * FORWARDS the shell it was handed. It cannot cover the seam above it, because its `loadWorker`
 * takes the shell as an ARGUMENT. Measured: emptying `htmlHead` where the adapter DERIVES it left
 * all five of its cases green.
 *
 * What is NOT the gap, corrected in the item itself before anyone acted on it: the slice semantics
 * are guarded. `find-root-div.test.ts` has 8 cases over the shared helper, including one asserting
 * the head half still contains `</head>`. What nothing exercised is `readDocumentShell` — so a
 * regression in THAT function, as opposed to in `findRootDiv`, reached nobody.
 *
 * #343's symptom was a served document with no `<head>`.
 */
const INDEX = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <link rel="stylesheet" href="/assets/app-abc123.css" />',
  '  </head>',
  '  <body>',
  '    <div id="root"></div>',
  '    <script type="module" src="/assets/entry-def456.js"></script>',
  '  </body>',
  '</html>',
].join('\n')

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-shell-'))
  mkdirSync(join(root, '.theokit', 'client'), { recursive: true })
  writeFileSync(join(root, '.theokit', 'client', 'index.html'), INDEX)
})

describe('the document shell is split at the root div', () => {
  it('test_the_head_half_carries_everything_before_the_mount_point', () => {
    const { htmlHead } = readDocumentShell(root, true)

    // The three things #343 served a document without. Asserting `<head>` alone would pass on a
    // head half truncated anywhere inside it.
    expect(
      htmlHead,
      'the head half is empty — the document would have no <head> at all',
    ).toBeTruthy()
    expect(htmlHead).toContain('<head>')
    expect(htmlHead).toContain('</head>')
    expect(htmlHead, 'the stylesheet is the thing a headless document visibly loses').toContain(
      '/assets/app-abc123.css',
    )
    expect(htmlHead, 'the head half ran past the mount point').toContain('<div id="root">')
  })

  it('test_the_tail_half_carries_the_client_entry_and_closes_the_document', () => {
    const { htmlTail } = readDocumentShell(root, true)

    expect(htmlTail).toContain('/assets/entry-def456.js')
    expect(htmlTail).toContain('</html>')
    // The control on the split: a tail that also carried the head would satisfy every assertion
    // above, and the two halves are concatenated around the rendered app.
    expect(htmlTail, 'the tail half carries the head too — the split did not happen').not.toContain(
      '<head>',
    )
  })

  it('test_the_two_halves_reconstruct_the_template_exactly', () => {
    const { htmlHead, htmlTail } = readDocumentShell(root, true)

    // The invariant that makes the split safe regardless of where it lands: nothing is lost and
    // nothing is duplicated. A swapped pair fails here even when both halves look plausible.
    expect(`${htmlHead ?? ''}${htmlTail ?? ''}`).toBe(INDEX)
  })

  it('test_streaming_off_reads_no_template_at_all', () => {
    // Not a detail: with streaming off the adapter must not require a client build to exist.
    expect(readDocumentShell(join(root, 'does-not-exist'), false)).toEqual({})
  })

  it('test_a_missing_template_refuses_by_name_rather_than_serving_a_headless_document', () => {
    expect(() => readDocumentShell(join(root, 'does-not-exist'), true)).toThrow(
      /ssrStreaming is on but .*index\.html does not exist/,
    )
  })

  it('test_a_template_with_no_mount_point_refuses_by_name', () => {
    const noRoot = mkdtempSync(join(tmpdir(), 'theo-shell-noroot-'))
    mkdirSync(join(noRoot, '.theokit', 'client'), { recursive: true })
    writeFileSync(
      join(noRoot, '.theokit', 'client', 'index.html'),
      '<!doctype html><html><head></head><body></body></html>',
    )

    expect(() => readDocumentShell(noRoot, true)).toThrow(/has no <div id="root">/)
  })
})
