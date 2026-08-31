import { dirname, join } from 'node:path'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

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
