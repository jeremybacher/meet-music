import { describe, expect, it } from 'vitest'
import { PANEL_CSS } from '../src/content/styles.js'

const themeBlock = (theme: string): string => {
  const start = PANEL_CSS.indexOf(`.root[data-theme="${theme}"] {`)
  expect(start, `missing the ${theme} token block`).toBeGreaterThan(-1)
  return PANEL_CSS.slice(start, PANEL_CSS.indexOf('}', start))
}

const tokensOf = (block: string): string[] =>
  [...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]).sort()

/**
 * Los dos colores literales que el diseño permite, los dos citas directas de Meet: el rojo del
 * micrófono cortado (con su blanco encima) y el verde del indicador de actividad. Un tercero es
 * un color inventado, y eso rompe el tema.
 */
const QUOTED_FROM_MEET = new Set(['#ea4335', '#d33426', '#ffffff', '#34a853'])

describe('sistema de tokens del panel', () => {
  it('define los dos temas', () => {
    expect(themeBlock('light').length).toBeGreaterThan(0)
    expect(themeBlock('dark').length).toBeGreaterThan(0)
  })

  /** Un token definido en un solo tema es una variable vacía en el otro: el color desaparece. */
  it('los dos temas definen exactamente los mismos tokens', () => {
    expect(tokensOf(themeBlock('dark'))).toEqual(tokensOf(themeBlock('light')))
  })

  it('no hay colores literales fuera de los bloques de tokens', () => {
    const withoutTokens = [themeBlock('light'), themeBlock('dark')].reduce(
      (css, block) => css.replace(block, ''),
      PANEL_CSS,
    )
    const literals = [...withoutTokens.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase())
    expect(literals.filter((c) => !QUOTED_FROM_MEET.has(c))).toEqual([])
  })

  /**
   * El CSS vive dentro de un template literal. Una comilla invertida en un comentario lo corta al
   * medio y el panel se queda sin la mitad de sus reglas, sin que nada falle a la vista.
   */
  it('no contiene comillas invertidas', () => {
    expect(PANEL_CSS).not.toContain('`')
  })

  /** La interfaz es toda en inglés; el español vive sólo en los comentarios del código. */
  it('no filtra texto en español a la interfaz', () => {
    const generated = [...PANEL_CSS.matchAll(/content:\s*"([^"]*)"/g)].map((m) => m[1])
    for (const text of generated) {
      expect(text).not.toMatch(/bajando|silenciado|cargando|reproduciendo/i)
    }
  })
})
