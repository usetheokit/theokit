import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { readXwdHeader, XwdFormatError, XwdNotWrittenError, xwdToPng } from '../src/tools/xwd.js'
import { buildXwd } from './xwd-fixtures.js'

const FILE = '/tmp/x/Xvfb_screen0'
const COLOURS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
] as const

/** The RGB triples of a filter-0 colour-type-2 PNG with one IDAT, read back without a PNG library. */
function pngPixels(png: Buffer): { width: number; height: number; rows: number[][] } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  expect(png[24]).toBe(8)
  expect(png[25]).toBe(2)
  const idatLength = png.readUInt32BE(33)
  const raw = inflateSync(png.subarray(41, 41 + idatLength))
  const stride = 1 + width * 3
  const rows: number[][] = []
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0)
    rows.push([...raw.subarray(y * stride + 1, (y + 1) * stride)])
  }
  return { width, height, rows }
}

describe('xwd', () => {
  it('decodes a known-colour XWD framebuffer to the same PNG pixels', () => {
    const { png, width, height } = xwdToPng(buildXwd({ width: 4, height: 1, pixels: COLOURS }), FILE)
    expect({ width, height }).toEqual({ width: 4, height: 1 })
    expect(pngPixels(png).rows).toEqual([[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]])
  })

  it('reads the channel masks at offsets 56, 60 and 64', () => {
    const header = readXwdHeader(buildXwd({ width: 4, height: 1 }), FILE)
    expect(header).toMatchObject({ width: 4, height: 1, bitsPerPixel: 32, bytesPerLine: 16, dataOffset: 100, lsbFirst: true })
    expect(header.masks).toEqual([0xff0000, 0xff00, 0xff])
  })

  it('honours MSBFirst byte order', () => {
    const { png } = xwdToPng(buildXwd({ width: 4, height: 1, pixels: COLOURS, msbFirst: true }), FILE)
    expect(pngPixels(png).rows).toEqual([[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]])
  })

  it('decodes 24 bits per pixel', () => {
    const { png } = xwdToPng(buildXwd({ width: 4, height: 1, pixels: COLOURS, bitsPerPixel: 24 }), FILE)
    expect(pngPixels(png).rows[0]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
  })

  it.each([
    ['pixmap_format', 1, buildXwd({ width: 4, height: 1, pixmapFormat: 1 })],
    ['bits_per_pixel', 16, buildXwd({ width: 4, height: 1, bitsPerPixel: 16 })],
    ['width', 0, buildXwd({ width: 0, height: 1 })],
    ['file length', 3, buildXwd({ width: 4, height: 1, truncateBy: 3 })],
  ])('refuses a %s it does not support', (field, value, bytes) => {
    const attempt = (): unknown => xwdToPng(bytes, FILE)
    expect(attempt).toThrow(XwdFormatError)
    expect(attempt).toThrow(new RegExp(`${field}.*${FILE.replaceAll('/', '\\/')}|${FILE.replaceAll('/', '\\/')}.*${field}`))
    expect(attempt).toThrow(String(value))
  })

  it.each([
    ['ncolors', { ncolors: 70_000 }, 70_000],
    ['header_size', { headerSize: 99 }, 99],
    ['header_size', { headerSize: 100_000 }, 100_000],
  ] as const)('refuses a %s of %j with a typed error naming the field', (field, options, value) => {
    const attempt = () => readXwdHeader(buildXwd({ width: 2, height: 2, ...options }), FILE)
    expect(attempt).toThrow(XwdFormatError)
    expect(attempt).toThrow(`${field} is ${value}`)
  })

  it('refuses an area past the pixel cap before allocating, naming width x height', () => {
    const bytes = buildXwd({ width: 1, height: 1 })
    bytes.writeUInt32BE(16384, 16)
    bytes.writeUInt32BE(16384, 20)
    bytes.writeUInt32BE(16384 * 4, 48)
    expect(() => readXwdHeader(bytes, FILE)).toThrow(`width x height is ${16384 * 16384}`)
    expect(() => xwdToPng(bytes, FILE)).toThrow(XwdFormatError)
  })

  it('accepts the largest header_size the buffer holds and a palette of 256 colours', () => {
    const bytes = buildXwd({ width: 2, height: 2, ncolors: 256, headerSize: 100 })
    expect(readXwdHeader(bytes, FILE).dataOffset).toBe(100 + 256 * 12)
  })

  it('decodes a header_size of 160 (a window name after the fixed header)', () => {
    const bytes = buildXwd({ width: 2, height: 1, headerSize: 160, pixels: [[1, 2, 3], [4, 5, 6]] })
    expect(readXwdHeader(bytes, FILE).dataOffset).toBe(160)
    expect(pngPixels(xwdToPng(bytes, FILE).png).rows).toEqual([[1, 2, 3, 4, 5, 6]])
  })

  it('says a file shorter than its header is not written yet', () => {
    const bytes = buildXwd({ width: 2, height: 1, headerSize: 160 }).subarray(0, 120)
    expect(() => readXwdHeader(bytes, FILE)).toThrow(XwdNotWrittenError)
    expect(() => readXwdHeader(bytes, FILE)).toThrow('not written yet')
  })

  it('refuses bytes too short to hold a header', () => {
    expect(() => readXwdHeader(Buffer.alloc(10), FILE)).toThrow(XwdFormatError)
  })

  it('decodes a 1024x768 32 bpp framebuffer in under 500 ms', () => {
    const bytes = buildXwd({ width: 1024, height: 768 })
    const started = performance.now()
    xwdToPng(bytes, FILE)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
