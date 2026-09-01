/** Independent DeepSeek Harness Host controlled through a private process channel. */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  healProfilesModuleFallback,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  parseShellMessage,
  STATION_PROTOCOL_VERSION,
  type HostToShellMessage,
  type StartHostCommand,
} from '../protocol.js'
import { stationDirectoryPickerPatches } from './directory-picker.js'
import { stationModelPatches } from './model-config.js'
import { shippedAgentPresetPatches } from './profile-config.js'
import { prepareGenerationRoot } from './workspace.js'

const NAME = 'dsh-station-host'
const require = createRequire(import.meta.url)

function send(message: HostToShellMessage): void {
  process.send?.(message)
}

function formatFailure(value: unknown, seen = new Set<unknown>()): string {
  if (!(value instanceof Error)) return String(value)
  if (seen.has(value)) return value.message
  seen.add(value)
  const details = [value.stack ?? `${value.name}: ${value.message}`]
  if (value instanceof AggregateError) {
    for (const error of value.errors) details.push(formatFailure(error, seen))
  }
  if (value.cause !== undefined) details.push(`Caused by: ${formatFailure(value.cause, seen)}`)
  return details.join('\n')
}

function installationAnchor(): string {
  return require.resolve('@deepseek-ai/dsh/package.json')
}

function composeProfile(
  command: StartHostCommand,
  environment: ReturnType<typeof loadLayeredEnv>,
): { root: string; patches: PatchOptions[]; anchor: string } {
  const anchor = installationAnchor()
  healProfilesModuleFallback(anchor)
  const profile = loadProfile(NAME, command.profile, anchor)
  const homeLayer = loadOptionalPatches(NAME, join(resolveDshHome(), PROFILE_PATCH_FILENAME)) ?? []
  const lowerPatches = [
    ...profile.layers.flatMap(layer => layer.patches),
    ...stationModelPatches(environment),
    ...stationDirectoryPickerPatches(command.generationId),
    ...profile.patches,
    ...homeLayer,
  ]
  return {
    root: prepareGenerationRoot(command.workDir),
    anchor,
    patches: structuredClone([
      ...lowerPatches,
      ...shippedAgentPresetPatches(anchor, lowerPatches),
    ]),
  }
}

async function bootHost(command: StartHostCommand): Promise<Context> {
  const environment = loadLayeredEnv(NAME)
  const profile = composeProfile(command, environment)
  return await boot(NAME, profile.root, profile.patches, (ctx) => {
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(ctx, {
      args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
      exit: () => { void ctx.fiber.dispose() },
    })
  }, pathToFileURL(profile.anchor).href)
}

let active: { generationId: string; context: Context } | undefined
let starting: { generationId: string; cancelled: boolean } | undefined
let exiting = false

function exitSoon(code: number): void {
  if (exiting) return
  exiting = true
  setImmediate(() => process.exit(code))
}

async function stop(generationId: string): Promise<void> {
  if (starting?.generationId === generationId) {
    starting.cancelled = true
    return
  }
  if (active?.generationId !== generationId) return
  const context = active.context
  active = undefined
  await context.fiber.dispose()
  send({ type: 'stopped', generationId })
  exitSoon(0)
}

async function start(command: StartHostCommand): Promise<void> {
  if (starting !== undefined || active !== undefined) {
    send({ type: 'failed', generationId: command.generationId, message: 'Host already owns a generation' })
    return
  }
  const pending = { generationId: command.generationId, cancelled: false }
  starting = pending
  try {
    const context = await bootHost(command)
    if (pending.cancelled) {
      await context.fiber.dispose()
      send({ type: 'stopped', generationId: command.generationId })
      exitSoon(0)
      return
    }
    const webServer = context.get('webServer')
    if (webServer === undefined) {
      await context.fiber.dispose()
      throw new Error('Web profile activated without the webServer service')
    }
    active = { generationId: command.generationId, context }
    send({
      type: 'ready',
      protocolVersion: STATION_PROTOCOL_VERSION,
      generationId: command.generationId,
      origin: `http://127.0.0.1:${String(webServer.port)}`,
    })
  } catch (cause: unknown) {
    send({
      type: 'failed',
      generationId: command.generationId,
      message: formatFailure(cause),
    })
    exitSoon(1)
  } finally {
    if (starting === pending) starting = undefined
  }
}

process.on('message', (raw: unknown) => {
  const message = parseShellMessage(raw)
  if (message === undefined) return
  if (message.type === 'stop') void stop(message.generationId)
  else if (message.type === 'start') void start(message)
})

async function shutdown(): Promise<void> {
  if (starting !== undefined) starting.cancelled = true
  if (active !== undefined) {
    const context = active.context
    active = undefined
    await context.fiber.dispose()
  }
  exitSoon(0)
}

process.once('disconnect', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
process.once('uncaughtException', (cause) => {
  console.error(cause)
  void shutdown().finally(() => process.exit(1))
})
process.once('unhandledRejection', (cause) => {
  console.error(cause)
  void shutdown().finally(() => process.exit(1))
})
