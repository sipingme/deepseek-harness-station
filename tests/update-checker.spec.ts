import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions, RELEASES_BASE_URL, UPDATE_METADATA_URL } from '../src/shell/update-checker.js'

describe('application update checks', () => {
  it('orders stable and prerelease semantic versions', () => {
    expect(compareVersions('0.1.3', '0.1.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('0.26.9-beta.0', '0.1.3')).toBeGreaterThan(0)
  })

  it('builds a trusted release URL when a newer version exists', async () => {
    const fetchLatest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ version: '0.1.3' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(checkForUpdate('0.1.2', fetchLatest)).resolves.toEqual({
      currentVersion: '0.1.2',
      latestVersion: '0.1.3',
      releaseUrl: `${RELEASES_BASE_URL}/v0.1.3`,
      updateAvailable: true,
    })
    expect(fetchLatest).toHaveBeenCalledWith(UPDATE_METADATA_URL, expect.objectContaining({ cache: 'no-store' }))
  })

  it('rejects malformed metadata and failed responses', async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(checkForUpdate('0.1.2', malformed)).rejects.toThrow(/does not contain a version/)

    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(checkForUpdate('0.1.2', unavailable)).rejects.toThrow(/HTTP 503/)
  })
})
