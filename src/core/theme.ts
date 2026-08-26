/** Tema del panel. Por defecto sigue al navegador. */

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export const resolveTheme = (pref: ThemePref): ResolvedTheme => {
  if (pref !== 'system') return pref
  return globalThis.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * Avisa cuando cambia el tema del sistema. Sólo importa con la preferencia en `system`, pero
 * escuchamos siempre y dejamos que quien llama decida: así cambiar de preferencia no exige
 * re-suscribirse.
 */
export const watchSystemTheme = (onChange: (theme: ResolvedTheme) => void): (() => void) => {
  const mq = globalThis.matchMedia?.(DARK_QUERY)
  if (!mq) return () => undefined
  const listener = (e: MediaQueryListEvent): void => onChange(e.matches ? 'dark' : 'light')
  mq.addEventListener('change', listener)
  return () => mq.removeEventListener('change', listener)
}
