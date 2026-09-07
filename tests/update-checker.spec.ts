import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions, UPDATE_METADATA_URL, UPDATE_FEED_URL } from '../src/shell/update-checker.js'

function release(version: string, options: { draft?: boolean, complete?: boolean } = {}) {
  const installerFilename = `DeepSeek-Harness-Station-${version}-x64-Setup.exe`
  const base = `https://github.com/sipingme/deepseek-harness-station/releases/download/v${version}`
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/sipingme/deepseek-harness-station/releases/tag/v${version}`,
    draft: options.draft ?? false,
    assets: options.complete === false ? [] : [
      { name: installerFilename, browser_download_url: `${base}/${installerFilename}` },
      { name: 'SHA256SUMS.txt', browser_download_url: `${base}/SHA256SUMS.txt` },
    ],
  }
}

describe('application update checks', () => {
  it('falls back after API rate limiting and skips releases without installers', async () => {
    const fetchLatest = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === UPDATE_METADATA_URL) return new Response('', { status: 403 })
      if (url === UPDATE_FEED_URL) return new Response('<feed><link href="https://github.com/sipingme/deepseek-harness-station/releases/tag/v0.26.9-beta.3"/><link href="https://github.com/sipingme/deepseek-harness-station/releases/tag/v0.26.9-beta.2"/></feed>')
      return new Response(null, { status: String(url).includes('beta.3') ? 404 : 200 })
    })
    await expect(checkForUpdate('0.26.9-beta.1', fetchLatest)).resolves.toMatchObject({
      latestVersion: '0.26.9-beta.2', updateAvailable: true,
    })
    expect(fetchLatest).toHaveBeenCalledWith(expect.stringContaining('SHA256SUMS.txt'), expect.objectContaining({ method: 'HEAD' }))
  })

  it('does not prompt an already updated user or let malformed rows hide valid releases', async () => {
    const fetchLatest = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { assets: [] }, null, release('0.26.9-beta.2'),
    ])))
    await expect(checkForUpdate('0.26.9-beta.2', fetchLatest)).resolves.toMatchObject({ updateAvailable: false })
  })

  it('orders stable and prerelease semantic versions', () => {
    expect(compareVersions('0.1.3', '0.1.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('0.26.9-beta.1', '0.26.9-beta.0')).toBeGreaterThan(0)
  })

  it('selects the newest complete GitHub release and its trusted assets', async () => {
    const fetchLatest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([
        release('0.26.9-beta.0', { complete: false }),
        release('0.26.9-beta.2'),
        release('0.26.9-beta.1'),
      ]), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await expect(checkForUpdate('0.26.9-beta.1', fetchLatest)).resolves.toEqual({
      currentVersion: '0.26.9-beta.1',
      latestVersion: '0.26.9-beta.2',
      releaseUrl: 'https://github.com/sipingme/deepseek-harness-station/releases/tag/v0.26.9-beta.2',
      installerFilename: 'DeepSeek-Harness-Station-0.26.9-beta.2-x64-Setup.exe',
      installerUrl: 'https://github.com/sipingme/deepseek-harness-station/releases/download/v0.26.9-beta.2/DeepSeek-Harness-Station-0.26.9-beta.2-x64-Setup.exe',
      checksumUrl: 'https://github.com/sipingme/deepseek-harness-station/releases/download/v0.26.9-beta.2/SHA256SUMS.txt',
      updateAvailable: true,
    })
    expect(fetchLatest).toHaveBeenCalledWith(UPDATE_METADATA_URL, expect.objectContaining({ cache: 'no-store' }))
  })

  it('rejects missing releases, untrusted assets and failed responses', async () => {
    const empty = vi.fn<typeof fetch>().mockResolvedValue(new Response('[]', { status: 200 }))
    await expect(checkForUpdate('0.26.9-beta.0', empty)).rejects.toThrow(/尚未发布/)

    const untrusted = release('0.26.9-beta.1')
    untrusted.assets[0]!.browser_download_url = 'https://example.com/Station.exe'
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([untrusted]), { status: 200 }),
    )
    await expect(checkForUpdate('0.26.9-beta.0', malformed)).rejects.toThrow(/尚未发布/)

    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(checkForUpdate('0.26.9-beta.0', unavailable)).rejects.toThrow(/HTTP 503/)
  })
})
