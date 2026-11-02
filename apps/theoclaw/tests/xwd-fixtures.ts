/** A tiny XWD ZPixmap file builder shared by the computer-use tests (header fields per X11/XWDFile.h). */
export interface XwdFixtureOptions {
  readonly width: number
  readonly height: number
  /** One `[r, g, b]` triple per pixel, row by row; default all black. */
  readonly pixels?: readonly (readonly [number, number, number])[]
  readonly bitsPerPixel?: 16 | 24 | 32
  readonly pixmapFormat?: number
  readonly msbFirst?: boolean
  /** Drop this many bytes from the end of the pixel data. */
  readonly truncateBy?: number
}

const HEADER_BYTES = 100

export function buildXwd(options: XwdFixtureOptions): Buffer {
  const { width, height, bitsPerPixel = 32, pixmapFormat = 2, msbFirst = false, truncateBy = 0 } = options
  const bytesPerPixel = bitsPerPixel / 8
  const bytesPerLine = width * bytesPerPixel
  const header = Buffer.alloc(HEADER_BYTES)
  const fields: Record<number, number> = {
    0: HEADER_BYTES,
    4: 7,
    8: pixmapFormat,
    12: 24,
    16: width,
    20: height,
    28: msbFirst ? 1 : 0,
    44: bitsPerPixel,
    48: bytesPerLine,
    56: 0xff0000,
    60: 0xff00,
    64: 0xff,
    76: 0,
  }
  for (const [offset, value] of Object.entries(fields)) header.writeUInt32BE(value, Number(offset))
  const data = Buffer.alloc(bytesPerLine * height)
  const pixels = options.pixels ?? []
  for (let index = 0; index < width * height; index++) {
    const [red, green, blue] = pixels[index] ?? [0, 0, 0]
    const value = (red << 16) | (green << 8) | blue
    const at = index * bytesPerPixel
    if (bytesPerPixel === 4) {
      if (msbFirst) data.writeUInt32BE(value >>> 0, at)
      else data.writeUInt32LE(value >>> 0, at)
    } else if (bytesPerPixel === 3) {
      const bytes = msbFirst ? [red, green, blue] : [blue, green, red]
      bytes.forEach((byte, offset) => data.writeUInt8(byte, at + offset))
    }
  }
  return Buffer.concat([header, data.subarray(0, data.length - truncateBy)])
}
