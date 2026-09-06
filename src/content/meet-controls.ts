/**
 * El botón de micrófono de la barra de controles de Meet: dónde está, cómo está y de qué color.
 *
 * Sirve para dos cosas. La primera es saber si estás silenciado en Meet, porque eso corta la pista
 * mezclada entera —música incluida— y hay que poder decirlo.
 *
 * La segunda es taparlo. Mientras suena música, el botón de micrófono de Meet hace lo que nadie
 * espera: te calla a vos *y* a la música. Tener al lado un segundo botón de micrófono que hace lo
 * correcto no arregla eso, sólo agrega una pregunta —¿cuál de los dos?— justo en el control que más
 * rápido hay que encontrar. Así que ocupamos su lugar exacto: un solo botón de micrófono, en el
 * lugar donde siempre estuvo, que hace lo que la situación pide.
 *
 * Se tapa, no se esconde: si el nuestro no llega a dibujarse, el de Meet sigue estando ahí y
 * funcionando. Y ocupamos su lugar **sólo** mientras apretarlo cortaría la música; en cualquier
 * otro momento el botón correcto es el de Meet y no tenemos nada que hacer ahí.
 *
 * Los patrones son multilingües a propósito: Meet se renderiza en el idioma de cada cuenta.
 */

const MIC_LABEL = /micr[oó]fono|microphone|mikrofon|microfone|micro\b|マイク|마이크|麦克风/i
/** Meet alterna la etiqueta entre "Silenciar micrófono" y "Activar micrófono". */
const UNMUTE_LABEL = /activar|unmute|turn on|encender|ativar|einschalten|réactiver|attiva/i

/** Dónde está y cómo se ve el botón que vamos a tapar. */
export interface MicButtonBox {
  top: number
  left: number
  width: number
  height: number
  /** Copiados del propio botón: Meet tiene su tema, que no tiene por qué ser el del panel. */
  bg: string | null
  fg: string | null
}

/**
 * ¿La etiqueta y el estado dicen que está silenciado?
 *
 * Pura y separada del DOM: es la parte que se puede verificar sin un navegador, y la que más
 * probablemente haya que ajustar cuando Meet cambie de palabras.
 */
export const isMutedLabel = (label: string, pressed: string | null): boolean =>
  pressed === 'true' || UNMUTE_LABEL.test(label)

export const findMicButton = (root: Document = document): HTMLElement | null => {
  const buttons = root.querySelectorAll<HTMLElement>('[role="button"][aria-label], button[aria-label]')
  for (const button of buttons) {
    if (MIC_LABEL.test(button.getAttribute('aria-label') ?? '')) return button
  }
  return null
}

/**
 * La caja del botón, o `null` si no hay nada que tapar: plegado, fuera de pantalla, o tan chico que
 * seguro no es el control real. Ante la duda devolvemos `null` y el nuestro vuelve al dock — es
 * preferible un botón en otro lado que uno flotando sobre el lugar equivocado.
 */
export const boxOf = (el: HTMLElement): MicButtonBox | null => {
  const r = el.getBoundingClientRect()
  if (r.width < 24 || r.height < 24) return null
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) {
    return null
  }

  const style = window.getComputedStyle(el)
  return {
    top: Math.round(r.top),
    left: Math.round(r.left),
    width: Math.round(r.width),
    height: Math.round(r.height),
    bg: opaque(style.backgroundColor) ? style.backgroundColor : null,
    fg: opaque(style.color) ? style.color : null,
  }
}

/** Un fondo transparente no sirve para tapar nada: mejor caer al color del panel. */
const opaque = (color: string): boolean =>
  color !== '' && color !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(color)

/**
 * Comparación por valor. La caja se vuelve a medir varias veces por segundo y llega siempre como un
 * objeto nuevo; sin esto, cada medición repintaría el panel entero.
 */
export const sameBox = (a: MicButtonBox | null, b: MicButtonBox | null): boolean => {
  if (a === null || b === null) return a === b
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height &&
    a.bg === b.bg &&
    a.fg === b.fg
  )
}
