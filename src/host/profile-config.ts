import { dirname, join } from 'node:path'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

/** The desktop shell owns the UI even when a user's Web profile enables browser handoff. */
export function desktopWebPatches(lowerPatches: readonly PatchOptions[]): PatchOptions[] {
  return composeEntries([[...lowerPatches]])
    .filter(entry => entry.name === '@deepseek-ai/dsh-web-app')
    .map(entry => ({
      id: entry.id,
      config: {
        ...(typeof entry.config === 'object' && entry.config !== null ? entry.config : {}),
        openBrowser: false,
      },
    }))
}

/** Mirror the official dsh launcher overlay that exposes its shipped agent presets. */
export function shippedAgentPresetPatches(
  installationAnchor: string,
  lowerPatches: readonly PatchOptions[],
): PatchOptions[] {
  const row = composeEntries([[...lowerPatches]]).find(entry => entry.id === 'agent-presets')
  if (row === undefined) return []
  const config = typeof row.config === 'object' && row.config !== null && !Array.isArray(row.config)
    ? row.config as Record<string, unknown>
    : {}
  return [{
    id: 'agent-presets',
    config: {
      ...config,
      roots: [{
        path: join(dirname(installationAnchor), 'config', 'agent-presets'),
        trust: 'system',
      }],
    },
  }]
}
