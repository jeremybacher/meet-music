/**
 * Cuánta gente hay en la llamada, leído del DOM de Meet.
 *
 * Existe para una sola cosa: enterarse de que **entró alguien nuevo**, y poder avisarle por el chat
 * que se está reproduciendo música. Sin esto, quien llega tarde ve una reunión con música saliendo
 * de la nada y ninguna pista de dónde viene ni cómo participar.
 *
 * Como todo lo que mira el DOM de Meet, es heurístico y tiene camino de degradación: si no se puede
 * leer el número, devuelve `null` y el resto sigue funcionando sin el aviso. Los patrones son
 * multilingües a propósito, porque Meet se renderiza en el idioma de la cuenta de cada persona, no
 * en el de la extensión.
 */

const PEOPLE_LABEL =
  /personas|participantes|participants|people|everyone|todos|pessoas|teilnehmer|partecipanti|deltagere|人数|参加者|참가자/i

/**
 * Saca el contador de un botón de "personas".
 *
 * Meet lo pone de dos formas según la versión: como texto suelto dentro del botón ("4"), o dentro
 * de la propia etiqueta ("Mostrar a todos (4)", "4 participants"). Pura y sin DOM: es la parte que
 * se puede verificar sin un navegador.
 */
export const parseParticipantCount = (label: string, text: string): number | null => {
  const bare = text.replace(/\s+/g, ' ').trim()
  if (/^\d{1,4}$/.test(bare)) return Number(bare)

  const parenthesised = /\((\d{1,4})\)/.exec(label)
  if (parenthesised) return Number(parenthesised[1])

  // "4 participants" / "4 personas". Se exige que el número abra la etiqueta para no confundirlo
  // con un atajo de teclado o un índice que Meet meta al final.
  const leading = /^\D{0,20}?(\d{1,4})\s+\D/.exec(label)
  return leading ? Number(leading[1]) : null
}

/** El número de participantes, o `null` si el DOM de Meet no lo dejó ver. */
export const readParticipantCount = (root: Document = document): number | null => {
  const buttons = root.querySelectorAll<HTMLElement>('button[aria-label], [role="button"][aria-label]')
  for (const button of buttons) {
    const label = button.getAttribute('aria-label') ?? ''
    if (!PEOPLE_LABEL.test(label)) continue
    const count = parseParticipantCount(label, button.textContent ?? '')
    if (count !== null && count > 0) return count
  }

  // Plan B: contar mosaicos. Menos confiable —Meet sólo monta los visibles— pero sirve para
  // detectar el salto de 1 a 2, que es exactamente el caso que nos importa.
  const tiles = new Set<string>()
  for (const el of root.querySelectorAll('[data-participant-id]')) {
    const id = el.getAttribute('data-participant-id')
    if (id) tiles.add(id)
  }
  return tiles.size > 0 ? tiles.size : null
}

/**
 * Avisa cuando el número de participantes sube. Nunca dispara en la primera lectura: no saber
 * cuánta gente había antes no es lo mismo que ver entrar a alguien.
 */
export const watchParticipants = (
  onJoin: (count: number, previous: number) => void,
  intervalMs = 3000,
): (() => void) => {
  let last: number | null = null
  const timer = setInterval(() => {
    const now = readParticipantCount()
    if (now === null) return
    if (last !== null && now > last) onJoin(now, last)
    last = now
  }, intervalMs)
  return () => clearInterval(timer)
}
