import { describe, expect, it } from 'vitest'
import { parseHostMessage, parseShellMessage, STATION_PROTOCOL_VERSION } from '../src/protocol.ts'

describe('Station lifecycle protocol', () => {
  it('accepts a complete start command', () => {
    expect(parseShellMessage({
      type: 'start',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      token: 'a'.repeat(43),
      profile: 'web',
    })).toEqual({
      type: 'start',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: 'generation-1',
      token: 'a'.repeat(43),
      profile: 'web',
    })
  })

  it('rejects protocol drift and short capabilities', () => {
    expect(parseShellMessage({
      type: 'start',
      protocolVersion: STATION_PROTOCOL_VERSION + 1,
      generationId: 'generation-1',
      token: 'short',
      profile: 'web',
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
})
