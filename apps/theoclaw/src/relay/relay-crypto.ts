import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'

/**
 * B-694 (OC-14) — the end-to-end layer of the claw-to-claw relay. Each instance holds an X25519
 * identity; a message is sealed to one peer's public key with an ephemeral key and the sender's
 * static key (both Diffie-Hellman results feed HKDF), then AES-256-GCM. The relay only ever
 * handles an `Envelope`, which carries public keys and ciphertext. The trust model: an instance
 * seals only to, and opens only from, peers named in its `TrustedPeers`.
 */

const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

/** An instance's identity: the private half never leaves the instance. */
export interface RelayIdentity {
  readonly publicKey: string
  readonly privateKey: string
}

/** What the relay stores and forwards. Nothing in it is plaintext. */
export interface Envelope {
  readonly to: string
  readonly from: string
  readonly ephemeral: string
  readonly nonce: string
  readonly ciphertext: string
}

/** Peers allowed to talk to this instance: name -> base64url public key. */
export type TrustedPeers = ReadonlyMap<string, string>

function pub(raw: string): KeyObject {
  const bytes = Buffer.from(raw, 'base64url')
  if (bytes.length !== 32) throw new Error('relay: a public key must be 32 bytes')
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, bytes]), format: 'der', type: 'spki' })
}

function priv(raw: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(raw, 'base64url')]),
    format: 'der',
    type: 'pkcs8',
  })
}

function rawPublic(key: KeyObject): string {
  return (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64url')
}

export function generateIdentity(): RelayIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publicKey: rawPublic(publicKey),
    privateKey: (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer)
      .subarray(16)
      .toString('base64url'),
  }
}

function sessionKey(a: Buffer, b: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.concat([a, b]), Buffer.alloc(0), info, 32))
}

function aad(from: string, to: string, ephemeral: string): Buffer {
  return Buffer.from(`theoclaw-relay-v1|${from}|${to}|${ephemeral}`)
}

/** Seals `plaintext` for the trusted peer `peerName`; refuses a peer that is not trusted. */
export function seal(
  me: RelayIdentity,
  trusted: TrustedPeers,
  peerName: string,
  plaintext: string,
): Envelope {
  const to = trusted.get(peerName)
  if (to === undefined) throw new Error(`relay: peer "${peerName}" is not trusted`)
  const eph = generateKeyPairSync('x25519')
  const ephemeral = rawPublic(eph.publicKey)
  const key = sessionKey(
    diffieHellman({ privateKey: eph.privateKey, publicKey: pub(to) }),
    diffieHellman({ privateKey: priv(me.privateKey), publicKey: pub(to) }),
    'theoclaw-relay-v1',
  )
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad(me.publicKey, to, ephemeral))
  const body = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return {
    to,
    from: me.publicKey,
    ephemeral,
    nonce: nonce.toString('base64url'),
    ciphertext: body.toString('base64url'),
  }
}

/**
 * Opens an envelope addressed to `me`. Refuses a sender outside the trusted set, and any
 * tampering (the sender, recipient and ephemeral key are authenticated). Returns the sender's
 * trusted name and the plaintext.
 */
export function open(
  me: RelayIdentity,
  trusted: TrustedPeers,
  envelope: Envelope,
): { readonly from: string; readonly plaintext: string } {
  if (envelope.to !== me.publicKey)
    throw new Error('relay: the envelope is not addressed to this instance')
  let name: string | undefined
  for (const [n, k] of trusted) if (k === envelope.from) name = n
  if (name === undefined) throw new Error('relay: the sender is not trusted')
  try {
    const key = sessionKey(
      diffieHellman({ privateKey: priv(me.privateKey), publicKey: pub(envelope.ephemeral) }),
      diffieHellman({ privateKey: priv(me.privateKey), publicKey: pub(envelope.from) }),
      'theoclaw-relay-v1',
    )
    const body = Buffer.from(envelope.ciphertext, 'base64url')
    if (body.length < 16) throw new Error('short')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'))
    decipher.setAAD(aad(envelope.from, envelope.to, envelope.ephemeral))
    decipher.setAuthTag(body.subarray(body.length - 16))
    const plaintext = Buffer.concat([
      decipher.update(body.subarray(0, body.length - 16)),
      decipher.final(),
    ]).toString('utf8')
    return { from: name, plaintext }
  } catch {
    throw new Error('relay: the envelope does not authenticate')
  }
}
