/**
 * Formato de cable de los mensajes que van por el chat de Meet.
 *
 * `[mm1] <base64url(iv || ciphertext)>` — una sola línea, que es lo que acepta el chat.
 *
 * El prefijo sirve para encontrarlos en el DOM y ocultarlos; la seguridad la da el cifrado, no el
 * prefijo. Alguien puede escribir `[mm1] cualquier cosa` a mano y no va a pasar la autenticación.
 */
import { type Msg, type Track, fromJson, toJson } from './protocol.js'
import { open, seal } from './crypto.js'

export const WIRE_PREFIX = '[mm1]'

/** Payloads posibles: base64url y de largo razonable para un mensaje de chat. */
export const WIRE_RE = /\[mm1\]\s+([A-Za-z0-9_-]{16,})/

/**
 * La miniatura no viaja: se deduce del id del video, así que mandarla es repetir información en un
 * canal donde cada carácter cuesta. En una cola de 20 temas eran ~1.600 caracteres de más.
 */
export const thumbFor = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/default.jpg`

const strip = (msg: Msg): Msg => {
  const bare = (t: Track): Track => ({ ...t, thumb: undefined })
  if (msg.op === 'add') return { ...msg, track: bare(msg.track) }
  if (msg.op === 'state') {
    return {
      ...msg,
      state: {
        ...msg.state,
        current: msg.state.current ? bare(msg.state.current) : null,
        queue: msg.state.queue.map(bare),
      },
    }
  }
  return msg
}

const restore = (msg: Msg): Msg => {
  const withThumb = (t: Track): Track => ({ ...t, thumb: t.thumb ?? thumbFor(t.id) })
  if (msg.op === 'add') return { ...msg, track: withThumb(msg.track) }
  if (msg.op === 'state') {
    return {
      ...msg,
      state: {
        ...msg.state,
        current: msg.state.current ? withThumb(msg.state.current) : null,
        queue: msg.state.queue.map(withThumb),
      },
    }
  }
  return msg
}

export const sealMsg = async (key: CryptoKey, msg: Msg): Promise<string> =>
  `${WIRE_PREFIX} ${await seal(key, toJson(strip(msg)))}`

/**
 * Devuelve null para todo lo que no sea un mensaje nuestro y válido: la charla normal del chat, un
 * mensaje de otra reunión, o algo escrito a mano imitando el formato.
 */
export const openMsg = async (key: CryptoKey, text: string): Promise<Msg | null> => {
  const match = WIRE_RE.exec(text.trim())
  if (!match) return null
  const json = await open(key, match[1])
  if (json === null) return null
  const msg = fromJson(json)
  return msg === null ? null : restore(msg)
}
