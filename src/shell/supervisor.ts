/** Process supervisor for exactly one independently owned Harness Host generation. */

import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseHostMessage, STATION_PROTOCOL_VERSION, type HostReadyEvent } from '../protocol.ts'

const START_TIMEOUT_MS = 45_000
const STOP_TIMEOUT_MS = 5_000

export interface HostSupervisorOptions {
  readonly hostEntry?: string
  readonly startTimeoutMs?: number
  readonly stopTimeoutMs?: number
  readonly executable?: string
  readonly environment?: NodeJS.ProcessEnv
}

/** Starts, validates and tears down one Host child process at a time. */
export class HostSupervisor {
  private child: ChildProcess | undefined
  private generationId: string | undefined

  constructor(private readonly options: HostSupervisorOptions = {}) {}

  async start(profile = 'web'): Promise<HostReadyEvent> {
    if (this.child !== undefined) throw new Error('DSH Station Host is already running')
    const generationId = randomUUID()
    const hostEntry = this.options.hostEntry ?? fileURLToPath(new URL('../host/main.js', import.meta.url))
    const child = fork(hostEntry, [], {
      execPath: this.options.executable ?? process.execPath,
      env: { ...process.env, ...this.options.environment, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    this.generationId = generationId
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)

    return await new Promise<HostReadyEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('DSH Station Host readiness timed out'))
      }, this.options.startTimeoutMs ?? START_TIMEOUT_MS)
      const settle = (error?: Error, ready?: HostReadyEvent): void => {
        clearTimeout(timer)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
        if (error !== undefined) {
          this.clear(child)
          reject(error)
        } else if (ready !== undefined) resolve(ready)
      }
      const onMessage = (raw: unknown): void => {
        const message = parseHostMessage(raw)
        if (message === undefined || message.generationId !== generationId) return
        if (message.type === 'ready') settle(undefined, message)
        else if (message.type === 'failed') settle(new Error(message.message))
      }
      const onError = (error: Error): void => { settle(error) }
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        settle(new Error(`DSH Station Host exited before readiness (${code === null ? signal ?? 'unknown' : String(code)})`))
      }
      child.on('message', onMessage)
      child.once('error', onError)
      child.once('exit', onExit)
      child.send({
        type: 'start',
        protocolVersion: STATION_PROTOCOL_VERSION,
        generationId,
        token: randomBytes(32).toString('base64url'),
        profile,
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    const generationId = this.generationId
    if (child === undefined || generationId === undefined) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        resolve()
      }, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      if (child.connected) child.send({ type: 'stop', generationId })
      else child.kill('SIGTERM')
    })
    this.clear(child)
  }

  private clear(child: ChildProcess): void {
    if (this.child !== child) return
    this.child = undefined
    this.generationId = undefined
  }
}
