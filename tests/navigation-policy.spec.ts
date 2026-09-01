import { describe, expect, it } from 'vitest'
import { classifyWindowOpen } from '../src/shell/navigation-policy.js'

describe('Electron window-open policy', () => {
  const origin = 'http://127.0.0.1:55510'

  it('keeps Host pages inside the desktop app', () => {
    expect(classifyWindowOpen(origin, `${origin}/`)).toBe('internal')
    expect(classifyWindowOpen(origin, `${origin}/sessions/new`)).toBe('internal')
  })

  it('opens only real web links externally and denies unsafe schemes', () => {
    expect(classifyWindowOpen(origin, 'https://deepseek.com/')).toBe('external')
    expect(classifyWindowOpen(origin, 'mailto:support@example.com')).toBe('external')
    expect(classifyWindowOpen(origin, 'file:///C:/Windows/System32')).toBe('deny')
    expect(classifyWindowOpen(origin, 'not a url')).toBe('deny')
  })
})
