import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'
import { stationDirectoryPickerPatches } from '../src/host/directory-picker.js'

describe('Station directory picker composition', () => {
  it('disables the Harness auto picker and mounts the Electron bridge', () => {
    const entries = composeEntries([
      [{ insert: [{ id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-auto' }] }],
      stationDirectoryPickerPatches('generation-1'),
    ])
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'directory-picker',
        name: '@deepseek-ai/dsh-host-directory-picker-auto',
        disabled: true,
      }),
      expect.objectContaining({
        id: 'station-directory-picker',
        config: { generationId: 'generation-1' },
      }),
      expect.objectContaining({
        id: 'station-directory-picker-ui',
        name: '@deepseek-ai/dsh-client-ui-directory-picker-native',
      }),
    ]))
  })
})
