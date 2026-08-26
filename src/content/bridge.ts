/**
 * Puente entre el content script aislado y el mundo MAIN, donde vive el mezclador.
 * Los dos mundos comparten el DOM pero no las variables, así que window.postMessage es el único
 * camino — y hay que filtrar, porque Meet también manda lo suyo por ahí.
 */
import { BRIDGE, type ToIsolated, type ToMain } from '../core/messages.js'

export const toMain = (msg: ToMain): void => {
  window.postMessage({ __bridge: BRIDGE, dir: 'to-main', msg }, window.location.origin)
}

export const onMain = (handler: (msg: ToIsolated) => void): (() => void) => {
  const listener = (event: MessageEvent): void => {
    if (event.source !== window) return
    const data = event.data as { __bridge?: string; dir?: string; msg?: ToIsolated }
    if (!data || data.__bridge !== BRIDGE || data.dir !== 'to-isolated' || !data.msg) return
    handler(data.msg)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
