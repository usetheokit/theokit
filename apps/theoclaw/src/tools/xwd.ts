import { crc32, deflateSync } from 'node:zlib'

/**
 * Decode an X Window Dump (what Xvfb keeps at `<-fbdir>/Xvfb_screen0`) to a PNG, with `node:zlib`
 * alone (B-676 D2). The header is 25 big-endian CARD32 fields (`X11/XWDFile.h`); only the ones a
 * ZPixmap framebuffer needs are read.
 */

/** A framebuffer this decoder does not support, naming the file, the field and its value. */
export class XwdFormatError extends Error {
  constructor(
    readonly path: string,
    readonly field: string,
    readonly value: number,
  ) {
    super(`${path} is not a supported XWD framebuffer: ${field} is ${value}`)
    this.name = 'XwdFormatError'
  }
}

export interface XwdHeader {
  readonly width: number
  readonly height: number
  readonly bitsPerPixel: number
  readonly bytesPerLine: number
  readonly dataOffset: number
  readonly lsbFirst: boolean
  readonly masks: readonly [number, number, number]
}

const HEADER_BYTES = 100
const COLOR_ENTRY_BYTES = 12
const ZPIXMAP = 2
const MAX_SIDE = 16384
/** The decoded RGB rows are 3 bytes a pixel, so this bounds the allocation near 100 MB. */
const MAX_PIXELS = 33_554_432
const MAX_COLORS = 65_536

/** The header_size and ncolors fields place the pixel data; both come from the file, so both are bounded. */
function dataOffsetOf(bytes: Buffer, path: string): number {
  const headerSize = bytes.readUInt32BE(0)
  if (headerSize < HEADER_BYTES || headerSize > bytes.length) throw new XwdFormatError(path, 'header_size', headerSize)
  const colors = bytes.readUInt32BE(76)
  if (colors > MAX_COLORS) throw new XwdFormatError(path, 'ncolors', colors)
  return headerSize + colors * COLOR_ENTRY_BYTES
}

/** The picture's size and depth: each side, the area (the allocation) and the pixel format. */
function checkGeometry(bytes: Buffer, path: string): void {
  const field = (offset: number): number => bytes.readUInt32BE(offset)
  const bitsPerPixel = field(44)
  const width = field(16)
  const height = field(20)
  if (field(8) !== ZPIXMAP) throw new XwdFormatError(path, 'pixmap_format', field(8))
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) throw new XwdFormatError(path, 'bits_per_pixel', bitsPerPixel)
  if (width < 1 || width > MAX_SIDE) throw new XwdFormatError(path, 'width', width)
  if (height < 1 || height > MAX_SIDE) throw new XwdFormatError(path, 'height', height)
  if (width * height > MAX_PIXELS) throw new XwdFormatError(path, 'width x height', width * height)
  if (field(48) < width * (bitsPerPixel / 8)) throw new XwdFormatError(path, 'bytes_per_line', field(48))
}

/** Read and check the header; pixel bytes are not required to be present (see `xwdToPng`). */
export function readXwdHeader(bytes: Buffer, path: string): XwdHeader {
  if (bytes.length < HEADER_BYTES) throw new XwdFormatError(path, 'file length', bytes.length)
  checkGeometry(bytes, path)
  const dataOffset = dataOffsetOf(bytes, path)
  const field = (offset: number): number => bytes.readUInt32BE(offset)
  const width = field(16)
  const height = field(20)
  const bitsPerPixel = field(44)
  const bytesPerLine = field(48)
  return {
    width,
    height,
    bitsPerPixel,
    bytesPerLine,
    dataOffset,
    lsbFirst: field(28) === 0,
    masks: [field(56), field(60), field(64)],
  }
}

function shiftOf(mask: number): number {
  return mask === 0 ? 0 : 31 - Math.clz32(mask & -mask)
}

function widthOf(mask: number): number {
  return mask === 0 ? 0 : 32 - Math.clz32(mask >>> shiftOf(mask))
}

/** A channel reader: the masked bits of a pixel, scaled to 8 bits when the mask is narrower. */
function channel(mask: number): (pixel: number) => number {
  const shift = shiftOf(mask)
  const bits = widthOf(mask)
  if (bits === 0) return () => 0
  const max = 2 ** bits - 1
  return (pixel) => (bits === 8 ? (pixel & mask) >>> shift : Math.round((((pixel & mask) >>> shift) * 255) / max))
}

function pixelReader(bytes: Buffer, header: XwdHeader): (offset: number) => number {
  const { bitsPerPixel, lsbFirst } = header
  if (bitsPerPixel === 32) return (offset) => (lsbFirst ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset))
  return (offset) =>
    lsbFirst ? bytes.readUIntLE(offset, 3) : bytes.readUIntBE(offset, 3)
}

/** The RGB rows of the framebuffer, each prefixed with the PNG filter byte 0. */
function filteredRows(bytes: Buffer, header: XwdHeader): Buffer {
  const { width, height, bytesPerLine, dataOffset, bitsPerPixel, masks } = header
  const [red, green, blue] = masks.map(channel) as [ReturnType<typeof channel>, ReturnType<typeof channel>, ReturnType<typeof channel>]
  const read = pixelReader(bytes, header)
  const step = bitsPerPixel / 8
  const stride = 1 + width * 3
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    let to = y * stride + 1
    let from = dataOffset + y * bytesPerLine
    for (let x = 0; x < width; x++, from += step) {
      const pixel = read(from)
      out[to++] = red(pixel)
      out[to++] = green(pixel)
      out[to++] = blue(pixel)
    }
  }
  return out
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Decode `bytes` (the whole XWD file named `path`) to an 8-bit RGB PNG. */
export function xwdToPng(bytes: Buffer, path: string): { png: Buffer; width: number; height: number } {
  const header = readXwdHeader(bytes, path)
  const needed = header.dataOffset + header.height * header.bytesPerLine
  if (bytes.length < needed) throw new XwdFormatError(path, 'file length', bytes.length)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(header.width, 0)
  ihdr.writeUInt32BE(header.height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filteredRows(bytes, header))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return { png, width: header.width, height: header.height }
}
