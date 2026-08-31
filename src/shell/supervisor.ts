/** Process supervisor for exactly one independently owned Harness Host generation. */

import { fork, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseHostMessage,
  STATION_PROTOCOL_VERSION,
  type HostReadyEvent,
  type PickDirectoryRequest,
} from '../protocol.js'

const START_TIMEOUT_MS = 45_000
const STOP_TIMEOUT_MS = 5_000

export interface UnexpectedHostExit {
  readonly generationId: string
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export interface HostSupervisorOptions {
  readonly hostEntry?: string
  readonly workRoot?: string
  readonly startTimeoutMs?: number
  readonly stopTimeoutMs?: number
  readonly executable?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly pickDirectory?: () => Promise<string | null>
  readonly onUnexpectedExit?: (event: UnexpectedHostExit) => void
}

/** Starts, validates and tears down one Host child process at a time. */
export class HostSupervisor {
  private child: ChildProcess | undefined
  private generationId: string | undefined
  private generationDir: string | undefined
  private stopping = false
  private prepared = false

  constructor(private readonly options: HostSupervisorOptions = {}) {}

  get running(): boolean {
    return this.child !== undefined
  }

  private get workRoot(): string {
    return resolve(this.options.workRoot ?? join(tmpdir(), 'deepseek-harness-station', 'host-generations'))
  }

  /** Remove directories left behind by an interrupted previous Station session. */
  async prepare(): Promise<void> {
    if (this.prepared) return
    await mkdir(this.workRoot, { recursive: true })
    const entries = await readdir(this.workRoot, { withFileTypes: true })
    await Promise.all(entries.map(async entry => {
      await rm(join(this.workRoot, entry.name), { recursive: true, force: true })
    }))
    this.prepared = true
  }

  async start(profile = 'web'): Promise<HostReadyEvent> {
    if (this.child !== undefined) throw new Error('DeepSeek Harness Station Host is already running')
    await this.prepare()
    const generationId = randomUUID()
    const generationDir = join(this.workRoot, generationId)
    await mkdir(generationDir, { recursive: false })
    const hostEntry = this.options.hostEntry ?? fileURLToPath(new URL('../host/main.js', import.meta.url))
    const child = fork(hostEntry, [], {
      execPath: this.options.executable ?? process.execPath,
      env: { ...process.env, ...this.options.environment, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    this.generationId = generationId
    this.generationDir = generationDir
    this.stopping = false
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
    child.on('message', raw => {
      const message = parseHostMessage(raw)
      if (message?.type === 'pick-directory') void this.answerDirectoryPicker(child, message)
    })

    let ready = false
    child.once('exit', (code, signal) => {
      const expected = this.stopping
      const owned = this.child === child
      this.clear(child)
      void this.cleanup(generationDir)
      if (owned && ready && !expected) this.options.onUnexpectedExit?.({ generationId, code, signal })
    })

    return await new Promise<HostReadyEvent>((resolveReady, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        settle(new Error('DeepSeek Harness Station Host readiness timed out'))
        void this.terminateTree(child)
      }, this.options.startTimeoutMs ?? START_TIMEOUT_MS)
      const settle = (error?: Error, event?: HostReadyEvent): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onStartupExit)
        if (error !== undefined) {
          this.clear(child)
          void this.cleanup(generationDir)
          reject(error)
        } else if (event !== undefined) {
          ready = true
          resolveReady(event)
        }
      }
      const onMessage = (raw: unknown): void => {
        const message = parseHostMessage(raw)
        if (message === undefined || message.generationId !== generationId) return
        if (message.type === 'ready') settle(undefined, message)
        else if (message.type === 'failed') settle(new Error(message.message))
      }
      const onError = (error: Error): void => { settle(error) }
      const onStartupExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        settle(new Error(`DeepSeek Harness Station Host exited before readiness (${code === null ? signal ?? 'unknown' : String(code)})`))
      }
      child.on('message', onMessage)
      child.once('error', onError)
      child.once('exit', onStartupExit)
      child.send({
        type: 'start',
        protocolVersion: STATION_PROTOCOL_VERSION,
        generationId,
        token: randomBytes(32).toString('base64url'),
        profile,
        workDir: generationDir,
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    const generationId = this.generationId
    const generationDir = this.generationDir
    if (child === undefined || generationId === undefined) return
    this.stopping = true
    await new Promise<void>((resolveStop) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveStop()
      }
      const timer = setTimeout(() => {
        void this.terminateTree(child).finally(finish)
      }, this.options.stopTimeoutMs ?? STOP_TIMEOUT_MS)
      child.once('exit', finish)
      if (child.connected) child.send({ type: 'stop', generationId })
      else void this.terminateTree(child).finally(finish)
    })
    this.clear(child)
    if (generationDir !== undefined) await this.cleanup(generationDir)
  }

  private async cleanup(directory: string): Promise<void> {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  private async terminateTree(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    if (process.platform !== 'win32' || child.pid === undefined) {
      child.kill('SIGKILL')
      return
    }
    await new Promise<void>((resolveKill) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.once('error', () => {
        child.kill('SIGKILL')
        resolveKill()
      })
      killer.once('exit', () => resolveKill())
    })
  }

  private async answerDirectoryPicker(child: ChildProcess, request: PickDirectoryRequest): Promise<void> {
    if (this.child !== child || this.generationId !== request.generationId || !child.connected) return
    try {
      if (this.options.pickDirectory === undefined) throw new Error('Station Shell has no native directory picker')
      const path = await this.options.pickDirectory()
      if (this.child !== child || this.generationId !== request.generationId || !child.connected) return
      child.send({
        type: 'pick-directory-result',
        protocolVersion: STATION_PROTOCOL_VERSION,
        generationId: request.generationId,
        requestId: request.requestId,
        path,
      })
    } catch (cause: unknown) {
      if (this.child !== child || this.generationId !== request.generationId || !child.connected) return
      child.send({
        type: 'pick-directory-result',
        protocolVersion: STATION_PROTOCOL_VERSION,
        generationId: request.generationId,
        requestId: request.requestId,
        path: null,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  private clear(child: ChildProcess): void {
    if (this.child !== child) return
    this.child = undefined
    this.generationId = undefined
    this.generationDir = undefined
  }
}
