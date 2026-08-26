import { describe, expect, it } from 'vitest'
import { isCallUrl, meetingCode } from '../src/content/meet-url.js'

describe('isCallUrl', () => {
  it('reconoce una reunión', () => {
    for (const href of [
      'https://meet.google.com/abc-defg-hij',
      'https://meet.google.com/abc-defg-hij/',
      'https://meet.google.com/abc-defg-hij?authuser=0',
      'https://meet.google.com/abc-defg-hij#hash',
      'https://meet.google.com/lookup/equipo-semanal',
    ]) {
      expect(isCallUrl(href), href).toBe(true)
    }
  })

  it('no aparece en la home ni en las páginas sueltas de Meet', () => {
    for (const href of [
      'https://meet.google.com/',
      'https://meet.google.com',
      'https://meet.google.com/landing',
      'https://meet.google.com/new',
      'https://meet.google.com/meetings',
      'https://meet.google.com/_meet/algo',
      'https://meet.google.com/abc-def-hij', // segmento del medio corto
      'https://meet.google.com/ABC-DEFG-HIJ', // los códigos son minúsculas
      'https://meet.google.com/abc-defg-hij/extra',
    ]) {
      expect(isCallUrl(href), href).toBe(false)
    }
  })

  it('ignora otros dominios y basura', () => {
    expect(isCallUrl('https://youtube.com/abc-defg-hij')).toBe(false)
    expect(isCallUrl('no-es-una-url')).toBe(false)
    expect(isCallUrl('')).toBe(false)
  })
})

describe('meetingCode', () => {
  it('extrae el código, que hace de secreto compartido de la sala', () => {
    expect(meetingCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij')
    expect(meetingCode('https://meet.google.com/abc-defg-hij/')).toBe('abc-defg-hij')
    expect(meetingCode('https://meet.google.com/abc-defg-hij?authuser=1')).toBe('abc-defg-hij')
    expect(meetingCode('https://meet.google.com/lookup/equipo-semanal')).toBe('equipo-semanal')
  })

  it('es el mismo para todos los participantes, sin importar cómo llegaron', () => {
    const desde = ['https://meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij?authuser=2#x']
    const codigos = new Set(desde.map(meetingCode))
    expect(codigos.size).toBe(1)
  })

  it('no devuelve nada fuera de una reunión', () => {
    expect(meetingCode('https://meet.google.com/')).toBeNull()
    expect(meetingCode('https://meet.google.com/landing')).toBeNull()
  })
})
