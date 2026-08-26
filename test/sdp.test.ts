import { describe, expect, it } from 'vitest'
import { preferHighQualityOpus } from '../src/core/sdp.js'

const params = (sdp: string, pt = '111'): Record<string, string> => {
  const line = new RegExp(`a=fmtp:${pt} (.*)`).exec(sdp)
  if (!line) return {}
  return Object.fromEntries(line[1].split(';').map((p) => p.split('=') as [string, string]))
}

describe('preferHighQualityOpus', () => {
  const base = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1',
  ].join('\r\n')

  it('pide estéreo y buen bitrate', () => {
    const out = params(preferHighQualityOpus(base))
    expect(out.stereo).toBe('1')
    expect(out['sprop-stereo']).toBe('1')
    expect(out.maxaveragebitrate).toBe('192000')
  })

  it('apaga DTX, que en música se escucha como cortes', () => {
    expect(params(preferHighQualityOpus(base)).usedtx).toBe('0')
  })

  it('conserva los parámetros que ya venían y no nos incumben', () => {
    expect(params(preferHighQualityOpus(base)).minptime).toBe('10')
  })

  it('agrega la línea fmtp si no existía', () => {
    const sinFmtp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2'
    const out = preferHighQualityOpus(sinFmtp)
    expect(out).toContain('a=fmtp:111 ')
    expect(params(out).stereo).toBe('1')
  })

  it('funciona con el payload type que sea', () => {
    const otro = 'v=0\r\na=rtpmap:96 opus/48000/2\r\na=fmtp:96 useinbandfec=1'
    expect(params(preferHighQualityOpus(otro), '96').maxaveragebitrate).toBe('192000')
  })

  it('deja intacto un SDP sin Opus', () => {
    const sinOpus = 'v=0\r\na=rtpmap:8 PCMA/8000'
    expect(preferHighQualityOpus(sinOpus)).toBe(sinOpus)
  })
})
