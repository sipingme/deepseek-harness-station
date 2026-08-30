import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generationWorkRoot } from '../src/shell/paths.js'

describe('Harness generation paths', () => {
  it('keeps roots below the profile module-resolution chain', () => {
    const home = join('C:', 'Users', 'station', '.dsh')
    expect(generationWorkRoot(home, 'web')).toBe(join(home, 'profiles', 'web', '.station-generations'))
  })

  it('rejects profile traversal', () => {
    expect(() => generationWorkRoot('C:\\dsh', '..')).toThrow(/Invalid Harness profile/)
    expect(() => generationWorkRoot('C:\\dsh', 'web/other')).toThrow(/Invalid Harness profile/)
  })
})
