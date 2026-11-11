import qrcode from 'qrcode-terminal'

import { whatsappBaileysAdapter } from './adapter-factory.js'

/** The terminal drawing of a pairing QR, a few lines of block characters. */
export function renderQr(qr: string): Promise<string> {
  return new Promise((resolve) => qrcode.generate(qr, { small: true }, resolve))
}

/** A QR sink that writes the drawing, with the instruction, to `write`. WhatsApp reissues the code until it is scanned. */
export function qrWriter(write: (text: string) => void): (qr: string) => void {
  return (qr) => {
    renderQr(qr).then(
      (drawing) => write(`whatsapp: scan this QR with WhatsApp (Settings > Linked devices > Link a device)\n${drawing}`),
      () => write(`whatsapp: scan this QR with WhatsApp (Linked devices): ${qr}`),
    )
  }
}

/**
 * Pair a number once: connect the Baileys backend over `sessionDir`, print the QR as WhatsApp reissues
 * it, and resolve true when the session opens (the pairing is then saved in `sessionDir`).
 */
export async function loginWhatsApp(sessionDir: string, write: (text: string) => void, connectTimeoutMs = 120_000): Promise<boolean> {
  const adapter = whatsappBaileysAdapter(sessionDir, { onQr: qrWriter(write), connectTimeoutMs })
  try {
    return await adapter.connect()
  } finally {
    await adapter.disconnect()
  }
}
