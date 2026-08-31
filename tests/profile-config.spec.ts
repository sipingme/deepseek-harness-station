import { join } from 'node:path'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'
import { shippedAgentPresetPatches } from '../src/host/profile-config.js'

describe('Station profile configuration', () => {
  it('preserves the effective roster config and adds the official shipped root', () => {
    const anchor = join('D:', 'station', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const lower = [
      { insert: [{ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: 'standard' } }] },
      { id: 'agent-presets', config: { default: 'code', includeUserRoot: false } },
    ]
    const entries = composeEntries([lower, shippedAgentPresetPatches(anchor, lower)])
    expect(entries.find(entry => entry.id === 'agent-presets')?.config).toEqual({
      default: 'code',
      includeUserRoot: false,
      roots: [{
        path: join('D:', 'station', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets'),
        trust: 'system',
      }],
    })
  })
})
