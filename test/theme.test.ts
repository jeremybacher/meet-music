import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTheme, watchSystemTheme } from '../src/core/theme.js'

const mockScheme = (dark: boolean, listeners: Array<(e: MediaQueryListEvent) => void> = []) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') && dark,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn),
    removeEventListener: () => undefined,
  }))
  return listeners
}

afterEach(() => vi.unstubAllGlobals())

describe('resolveTheme', () => {
  it('respeta la elección explícita sin mirar el navegador', () => {
    mockScheme(true)
    expect(resolveTheme('light')).toBe('light')
    mockScheme(false)
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('con `system` sigue al navegador', () => {
    mockScheme(true)
    expect(resolveTheme('system')).toBe('dark')
    mockScheme(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('cae en claro si el navegador no expone matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('watchSystemTheme', () => {
  it('avisa cuando el sistema cambia de tema', () => {
    const listeners = mockScheme(false)
    const seen: string[] = []
    watchSystemTheme((theme) => seen.push(theme))

    listeners[0]?.({ matches: true } as MediaQueryListEvent)
    listeners[0]?.({ matches: false } as MediaQueryListEvent)

    expect(seen).toEqual(['dark', 'light'])
  })

  it('no explota sin matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => watchSystemTheme(() => undefined)()).not.toThrow()
  })
})
