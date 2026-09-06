/**
 * Cuánta gente hay en la llamada, leído del DOM de Meet.
 *
 * Existe para una sola cosa: enterarse de que **entró alguien nuevo**, y poder avisarle por el chat
 * que se está reproduciendo música. Sin esto, quien llega tarde ve una reunión con música saliendo
 * de la nada y ninguna pista de dónde viene ni cómo participar. Y hace falta leerlo del DOM porque
 * el chat de Meet no muestra lo anterior a que entraras: un mensaje mandado antes no existe para
 * quien acaba de llegar.
 *
 * Como todo lo que mira el DOM de Meet, es heurístico. Por eso no devuelve sólo un número, sino
 * también **de dónde salió**: sin eso, "no avisó" y "no encontró el contador" se ven idénticos
 * desde afuera, que es exactamente cómo se pierde una tarde. El panel lo muestra.
 *
 * Los patrones son multilingües a propósito, porque Meet se renderiza en el idioma de la cuenta de
 * cada persona, no en el de la extensión.
 */

const PEOPLE_LABEL =
  /personas|participantes|participants|people|everyone|todos|pessoas|teilnehmer|partecipanti|deltakere|人数|参加者|참가자/i

/**
 * Lo que **no** es el botón de personas aunque su etiqueta se le parezca.
 *
 * "Chat with everyone" matchea `everyone` igual que "Show everyone", y su insignia es la de
 * mensajes sin leer. Tomarla por el conteo de participantes hace que cada mensaje del chat parezca
 * alguien entrando, y la extensión se pone a escribir avisos sola.
 */
const NOT_PEOPLE = /chat|mensaje|messages?|conversa|bate-papo|채팅|チャット/i

/** De dónde salió el número. Va a la vista para poder diagnosticar sin abrir el inspector. */
export type CountSource = 'badge' | 'label' | 'roster' | null

export interface ParticipantReading {
  count: number | null
  source: CountSource
}

export const UNKNOWN: ParticipantReading = { count: null, source: null }

const NUMBER = /^\d{1,4}$/

/** ¿Es el botón que abre la lista de participantes, y no otro que se le parece? */
export const isPeopleLabel = (label: string): boolean =>
  PEOPLE_LABEL.test(label) && !NOT_PEOPLE.test(label)

/**
 * El contador metido en la propia etiqueta: "Mostrar a todos (4)", "4 participants".
 *
 * Se exige que el número abra la etiqueta o venga entre paréntesis. Meet mete números sueltos en
 * varias etiquetas (atajos, índices) y confundir uno con el conteo dispara avisos sin que haya
 * entrado nadie, que es peor que no avisar.
 */
export const parseCountFromLabel = (label: string): number | null => {
  const parenthesised = /\((\d{1,4})\)/.exec(label)
  if (parenthesised) return Number(parenthesised[1])

  const leading = /^\D{0,20}?(\d{1,4})\s+\D/.exec(label)
  return leading ? Number(leading[1]) : null
}

/**
 * Texto propio de un elemento, sin el de sus hijos.
 *
 * Es la corrección que hacía falta: los íconos de Meet son **ligaduras de fuente**, así que el
 * `textContent` del botón incluye el nombre del ícono. Un botón de personas con la insignia en 3
 * da "people_alt3", que no es un número y no matcheaba nada. Mirando el texto propio de cada
 * descendiente, la insignia aparece sola.
 */
const directText = (el: Element): string => {
  let out = ''
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? ''
  }
  return out.trim()
}

/** Un número suelto dentro del subárbol: la insignia del contador. */
const badgeIn = (root: Element): number | null => {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const own = directText(el)
    if (NUMBER.test(own)) {
      const value = Number(own)
      if (value > 0) return value
    }
  }
  return null
}

/** Cuánta gente hay, y por qué vía se supo. */
export const readParticipants = (root: Document = document): ParticipantReading => {
  const people = [
    ...root.querySelectorAll<HTMLElement>('[role="button"][aria-label], button[aria-label]'),
  ].filter((b) => isPeopleLabel(b.getAttribute('aria-label') ?? ''))

  // La insignia es lo más exacto que hay: es el número que Meet decidió mostrar.
  for (const button of people) {
    const badge = badgeIn(button)
    if (badge !== null) return { count: badge, source: 'badge' }
  }

  for (const button of people) {
    const inLabel = parseCountFromLabel(button.getAttribute('aria-label') ?? '')
    if (inLabel !== null && inLabel > 0) return { count: inLabel, source: 'label' }
  }

  // Plan B: contar identidades del roster. Meet sólo monta lo visible, así que puede quedarse
  // corto, pero alcanza para ver el salto de 1 a 2, que es el caso que importa.
  const ids = new Set<string>()
  for (const el of root.querySelectorAll(
    '[data-participant-id], [data-requested-participant-id], [data-initial-participant-id]',
  )) {
    for (const attr of ['data-participant-id', 'data-requested-participant-id', 'data-initial-participant-id']) {
      const id = el.getAttribute(attr)
      if (id) ids.add(id)
    }
  }
  if (ids.size > 0) return { count: ids.size, source: 'roster' }

  return UNKNOWN
}

/**
 * Avisa cuando el número de participantes sube.
 *
 * Dos recaudos, los dos para no escribir en el chat de una reunión ajena sin motivo:
 *
 * - Nunca dispara en la primera lectura. No saber cuánta gente había antes no es lo mismo que ver
 *   entrar a alguien.
 * - Un número nuevo tiene que repetirse en dos lecturas seguidas antes de valer. El conteo del
 *   roster parpadea cuando Meet remonta mosaicos, y un parpadeo no es una persona.
 */
export const watchParticipants = (
  onJoin: (reading: ParticipantReading) => void,
  onRead: (reading: ParticipantReading) => void,
  intervalMs = 3000,
): (() => void) => {
  let confirmed: number | null = null
  let pending: number | null = null

  const timer = setInterval(() => {
    const reading = readParticipants()
    onRead(reading)
    if (reading.count === null) return

    if (reading.count !== pending) {
      pending = reading.count
      return
    }
    if (confirmed !== null && reading.count > confirmed) onJoin(reading)
    confirmed = reading.count
  }, intervalMs)

  return () => clearInterval(timer)
}
