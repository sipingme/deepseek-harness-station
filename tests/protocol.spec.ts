import { describe, expect, it } from 'vitest'
import { parseHostMessage, parseShellMessage, STATION_PROTOCOL_VERSION } from '../src/protocol.js'

describe('Station lifecycle protocol', () => {
  it('accepts a complete start command', () => {
    expect(parseShellMessage({
      type: 'start',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      token: 'a'.repeat(43),
      profile: 'web',
      workDir: 'C:\\station\\generation-1',
    })).toEqual({
      type: 'start',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      token: 'a'.repeat(43),
      profile: 'web',
      workDir: 'C:\\station\\generation-1',
    })
  })

  it('rejects protocol drift and short capabilities', () => {
    expect(parseShellMessage({
      type: 'start',
      protocolVersion: STATION_PROTOCOL_VERSION + 1,
      generationId: 'generation-1',
      token: 'short',
      profile: 'web',
      workDir: 'C:\\station\\generation-1',
    })).toBeUndefined()
  })

  it('accepts readiness only for an exact loopback origin', () => {
    expect(parseHostMessage({
      type: 'ready',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      origin: 'http://127.0.0.1:43125',
    })?.type).toBe('ready')
    expect(parseHostMessage({
      type: 'ready',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      origin: 'https://example.com',
    })).toBeUndefined()
  })

  it('validates native directory picker IPC in both directions', () => {
    expect(parseHostMessage({
      type: 'pick-directory',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      requestId: 'request-1',
    })?.type).toBe('pick-directory')
    expect(parseShellMessage({
      type: 'pick-directory-result',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      requestId: 'request-1',
      path: 'D:\\2026',
    })?.type).toBe('pick-directory-result')
  })
})
