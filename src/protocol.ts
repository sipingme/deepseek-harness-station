/** Version of the private Station Shell-to-Host lifecycle protocol. */
export const STATION_PROTOCOL_VERSION = 1

/** Shell-owned configuration sent once to a newly spawned Host. */
export interface StartHostCommand {
  readonly type: 'start'
  readonly protocolVersion: number
  readonly generationId: string
  readonly token: string
  readonly profile: string
}

/** Graceful stop request for the active Host generation. */
export interface StopHostCommand {
  readonly type: 'stop'
  readonly generationId: string
}

/** Messages accepted by the Host over the private parent-child channel. */
export type ShellToHostMessage = StartHostCommand | StopHostCommand

/** Host readiness published only after the complete Harness tree activates. */
export interface HostReadyEvent {
  readonly type: 'ready'
  readonly protocolVersion: number
  readonly generationId: string
  readonly origin: string
}

/** Structured Host startup or runtime failure. */
export interface HostFailedEvent {
  readonly type: 'failed'
  readonly generationId: string
  readonly message: string
}

/** Host acknowledgement after its Cordis tree has been disposed. */
export interface HostStoppedEvent {
  readonly type: 'stopped'
  readonly generationId: string
}

/** Messages emitted by the Host over the private parent-child channel. */
export type HostToShellMessage = HostReadyEvent | HostFailedEvent | HostStoppedEvent

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate an untrusted process message before the Host acts on it. */
export function parseShellMessage(value: unknown): ShellToHostMessage | undefined {
  if (!record(value) || typeof value.type !== 'string' || typeof value.generationId !== 'string') return undefined
  if (value.type === 'stop') return { type: 'stop', generationId: value.generationId }
  if (value.type !== 'start'
    || value.protocolVersion !== STATION_PROTOCOL_VERSION
    || typeof value.token !== 'string'
    || value.token.length < 43
    || typeof value.profile !== 'string'
    || value.profile.length === 0) return undefined
  return {
    type: 'start',
    protocolVersion: STATION_PROTOCOL_VERSION,
    generationId: value.generationId,
    token: value.token,
    profile: value.profile,
  }
}

/** Validate an untrusted process message before the Shell changes state. */
export function parseHostMessage(value: unknown): HostToShellMessage | undefined {
  if (!record(value) || typeof value.type !== 'string' || typeof value.generationId !== 'string') return undefined
  if (value.type === 'ready'
    && value.protocolVersion === STATION_PROTOCOL_VERSION
    && typeof value.origin === 'string') {
    try {
      const origin = new URL(value.origin)
      if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== value.origin) return undefined
      return { type: 'ready', protocolVersion: STATION_PROTOCOL_VERSION, generationId: value.generationId, origin: value.origin }
    } catch {
      return undefined
    }
  }
  if (value.type === 'failed' && typeof value.message === 'string') {
    return { type: 'failed', generationId: value.generationId, message: value.message }
  }
  if (value.type === 'stopped') return { type: 'stopped', generationId: value.generationId }
  return undefined
}
