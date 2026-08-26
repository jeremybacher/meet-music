/**
 * ¿Estamos dentro de una reunión o en la home de Meet?
 *
 * Los códigos de reunión tienen forma `xxx-xxxx-xxx` en minúsculas. Todo lo demás —la home, `/new`,
 * `/landing`, la lista de reuniones— no es una llamada y ahí el panel no tiene nada que hacer.
 */

const MEETING_CODE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/
/** `/lookup/<apodo>` es transitorio: Meet redirige al código real, pero ya es una llamada. */
const LOOKUP = /^\/lookup\/[^/]+$/

/**
 * El código de la reunión, que hace de secreto compartido para cifrar la cola: lo tienen todos los
 * participantes y nadie de afuera. Para `/lookup/<apodo>` sirve el apodo, que cumple lo mismo.
 */
export const meetingCode = (href: string): string | null => {
  if (!isCallUrl(href)) return null
  return new URL(href).pathname.replace(/\/+$/, '').replace(/^\/(lookup\/)?/, '')
}

export const isCallUrl = (href: string): boolean => {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.hostname !== 'meet.google.com') return false

  const path = url.pathname.replace(/\/+$/, '') || '/'
  return MEETING_CODE.test(path) || LOOKUP.test(path)
}

/**
 * Meet es una SPA: entrar y salir de una llamada no recarga la página, así que no alcanza con mirar
 * la URL una sola vez. Sondear es más simple y confiable que parchear el History API, y a este
 * intervalo no cuesta nada.
 */
export const watchCallState = (onChange: (inCall: boolean) => void): (() => void) => {
  let last = isCallUrl(location.href)
  const timer = setInterval(() => {
    const now = isCallUrl(location.href)
    if (now !== last) {
      last = now
      onChange(now)
    }
  }, 1000)
  return () => clearInterval(timer)
}
