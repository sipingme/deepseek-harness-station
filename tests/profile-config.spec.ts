import { join } from 'node:path'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'
import { desktopWebPatches, shippedAgentPresetPatches } from '../src/host/profile-config.js'

describe('Station profile configuration', () => {
  it('disables browser handoff after user overrides while preserving other Web settings', () => {
    const lower = [
      { insert: [{ id: 'custom-web', name: '@deepseek-ai/dsh-web-app', config: { openBrowser: false } }] },
      { id: 'custom-web', config: { openBrowser: true, printUrl: false, surfaceContext: true } },
    ]
    const entries = composeEntries([lower, desktopWebPatches(lower)])
    expect(entries.find(entry => entry.id === 'custom-web')?.config).toEqual({
      openBrowser: false, printUrl: false, surfaceContext: true,
    })
    expect(lower[1]?.config?.openBrowser).toBe(true)
  })
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
