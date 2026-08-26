/**
 * Cifrado de los mensajes que viajan por el chat de Meet.
 *
 * La clave se deriva del **código de la reunión**, que ya es un secreto compartido: lo tienen todos
 * los que están adentro y nadie de afuera. No hay nada que configurar ni que intercambiar.
 *
 * AES-GCM además autentica: un mensaje que no fue cifrado con esta clave no descifra, punto. Eso es
 * lo que impide que alguien —a propósito o de casualidad— escriba algo en el chat que la extensión
 * llegue a interpretar como una orden.
 *
 * No pretende resistir a un participante malicioso de la propia reunión: quien tiene el código tiene
 * la clave. Alcanza para que la cola sea privada de la reunión y no la pise el chat humano.
 */

const SALT = new TextEncoder().encode('meet-music/v1')
const ITERATIONS = 100_000
const IV_BYTES = 12

/** Derivar es caro; se hace una vez por sala y se reusa. */
export const deriveKey = async (roomSecret: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(roomSecret),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Devuelve base64url de `iv || ciphertext`. */
export const seal = async (key: CryptoKey, plaintext: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  const packed = new Uint8Array(iv.length + ciphertext.length)
  packed.set(iv)
  packed.set(ciphertext, iv.length)
  return toBase64Url(packed)
}

/** null si el payload no es nuestro: otra reunión, texto humano, o algo manipulado. */
export const open = async (key: CryptoKey, payload: string): Promise<string | null> => {
  try {
    const packed = fromBase64Url(payload)
    if (packed.length <= IV_BYTES) return null
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES) },
      key,
      packed.slice(IV_BYTES),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
