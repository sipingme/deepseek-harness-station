/** Navigation decisions shared by the Electron shell and its tests. */

export type WindowOpenDisposition = 'internal' | 'external' | 'deny'

export function classifyWindowOpen(trustedOrigin: string, targetUrl: string): WindowOpenDisposition {
  try {
    const target = new URL(targetUrl)
    if (target.origin === trustedOrigin) return 'internal'
    if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
      return 'external'
    }
  } catch {
    // Malformed targets remain denied.
  }
  return 'deny'
}
