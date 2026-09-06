import { describe, expect, it } from 'vitest'
import { formatDuration, parseLink } from '../src/youtube/parse-url.js'

describe('parseLink', () => {
  it('acepta las formas que la gente realmente pega', () => {
    const cases: Array<[string, string]> = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM', 'dQw4w9WgXcQ'],
      ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
      ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ]
    for (const [input, expected] of cases) {
      expect(parseLink(input), input).toEqual({ ok: true, videoId: expected })
    }
  })

  it('rechaza lo que no es un video, cada cosa por su motivo', () => {
    expect(parseLink('daft punk around the world').ok).toBe(false)
    expect(parseLink('').ok).toBe(false)
    expect(parseLink('https://vimeo.com/123456').ok).toBe(false)
    expect(parseLink('https://www.youtube.com/').ok).toBe(false)
    // Diez caracteres: no es un id válido.
    expect(parseLink('dQw4w9WgXc').ok).toBe(false)
  })
})

describe('formatDuration', () => {
  it('agrega la hora sólo cuando hace falta', () => {
    expect(formatDuration(253)).toBe('4:13')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(9)).toBe('0:09')
  })

  it('muestra un placeholder mientras no sabemos la duración', () => {
    expect(formatDuration(undefined)).toBe('--:--')
    expect(formatDuration(Number.NaN)).toBe('--:--')
  })
})

/**
 * El campo muestra un mensaje distinto por caso. Un "link inválido" genérico deja a la persona
 * exactamente donde estaba: lo que hace falta es el siguiente paso, y cada motivo tiene el suyo.
 */
describe('por qué un texto no sirve', () => {
  it('un video sigue devolviendo su id', () => {
    expect(parseLink('https://youtu.be/dQw4w9WgXcQ')).toEqual({ ok: true, videoId: 'dQw4w9WgXcQ' })
  })

  it('el campo vacío no es un error, es no haber empezado', () => {
    expect(parseLink('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('distingue YouTube-pero-no-un-video', () => {
    const cases = [
      'https://www.youtube.com/playlist?list=PL1234',
      'https://www.youtube.com/@algunCanal',
      'https://www.youtube.com/results?search_query=daft+punk',
      'https://www.youtube.com/',
    ]
    for (const url of cases) {
      expect(parseLink(url), url).toEqual({ ok: false, reason: 'no-video' })
    }
  })

  it('reconoce los otros servicios por nombre', () => {
    expect(parseLink('https://open.spotify.com/track/abc')).toEqual({
      ok: false,
      reason: 'other-service',
      service: 'Spotify',
    })
    expect(parseLink('https://soundcloud.com/artista/tema')).toEqual({
      ok: false,
      reason: 'other-service',
      service: 'SoundCloud',
    })
  })

  it('el resto es simplemente no-YouTube', () => {
    expect(parseLink('daft punk around the world')).toEqual({ ok: false, reason: 'not-youtube' })
    expect(parseLink('https://example.com/algo')).toEqual({ ok: false, reason: 'not-youtube' })
  })

  /** Un id de 11 caracteres pegado suelto sigue valiendo: es lo que devuelve "copiar id". */
  it('un id suelto sigue siendo válido', () => {
    expect(parseLink('dQw4w9WgXcQ')).toEqual({ ok: true, videoId: 'dQw4w9WgXcQ' })
  })
})
