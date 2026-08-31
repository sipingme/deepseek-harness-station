/** Native directory picker bridged to Electron instead of the crashing Win32 Koffi worker. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import {
  parseShellMessage,
  STATION_PROTOCOL_VERSION,
  type HostToShellMessage,
  type PickDirectoryResult,
} from '../protocol.js'

interface Config {
  readonly generationId: string
}

interface PendingPick {
  readonly resolve: (path: string | null) => void
  readonly reject: (error: Error) => void
  readonly dispose: () => void
}

/** Replace Harness's Win32 Koffi worker while retaining its native client surface. */
export function stationDirectoryPickerPatches(generationId: string): PatchOptions[] {
  return [
    { id: 'directory-picker', disabled: true },
    {
      insert: [
        {
          id: 'station-directory-picker',
          name: import.meta.url,
          config: { generationId },
        },
        {
          id: 'station-directory-picker-ui',
          name: '@deepseek-ai/dsh-client-ui-directory-picker-native',
        },
      ],
    },
  ]
}

export default class StationDirectoryPicker extends DirectoryPicker {
  private readonly pending = new Map<string, PendingPick>()
  private readonly nativeCapability = {
    kind: 'native' as const,
    pick: (signal: AbortSignal): Promise<string | null> => this.pick(signal),
  }

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    const onMessage = (raw: unknown): void => {
      const message = parseShellMessage(raw)
      if (message?.type !== 'pick-directory-result' || message.generationId !== this.config.generationId) return
      this.finish(message)
    }
    process.on('message', onMessage)
    ctx.effect(() => () => {
      process.off('message', onMessage)
      for (const request of this.pending.values()) request.reject(new Error('native directory picker disposed'))
      this.pending.clear()
    }, 'station-directory-picker: shell bridge')
  }

  capability(): typeof this.nativeCapability {
    return this.nativeCapability
  }

  private finish(message: PickDirectoryResult): void {
    const request = this.pending.get(message.requestId)
    if (request === undefined) return
    request.dispose()
    if (message.error !== undefined) request.reject(new Error(message.error))
    else request.resolve(message.path)
  }

  private async pick(signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted()
    if (process.send === undefined) throw new Error('native directory picker requires the Station Shell')
    const requestId = randomUUID()
    return await new Promise<string | null>((resolve, reject) => {
      const onAbort = (): void => {
        const request = this.pending.get(requestId)
        if (request === undefined) return
        request.dispose()
        reject(new Error('native directory picker aborted'))
      }
      const dispose = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.pending.delete(requestId)
      }
      this.pending.set(requestId, { resolve, reject, dispose })
      signal.addEventListener('abort', onAbort, { once: true })
      const message: HostToShellMessage = {
        type: 'pick-directory',
        protocolVersion: STATION_PROTOCOL_VERSION,
        generationId: this.config.generationId,
        requestId,
      }
      process.send?.(message, error => {
        if (error === null) return
        const request = this.pending.get(requestId)
        if (request === undefined) return
        request.dispose()
        reject(error)
      })
    })
  }
}
