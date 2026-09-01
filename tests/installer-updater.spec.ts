import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { downloadVerifiedInstaller, expectedInstallerHash } from '../src/shell/installer-updater.js'
import type { UpdateCheckResult } from '../src/shell/update-checker.js'

const filename = 'DeepSeek-Harness-Station-0.26.9-beta.1-x64-Setup.exe'
const payload = Buffer.from('verified installer payload')
const digest = createHash('sha256').update(payload).digest('hex')

function result(): UpdateCheckResult {
  return {
    currentVersion: '0.26.9-beta.0',
    latestVersion: '0.26.9-beta.1',
    releaseUrl: 'https://github.com/sipingme/deepseek-harness-station/releases/tag/v0.26.9-beta.1',
    installerFilename: filename,
    installerUrl: `https://github.com/example/releases/download/v1/${filename}`,
    checksumUrl: 'https://github.com/example/releases/download/v1/SHA256SUMS.txt',
    updateAvailable: true,
  }
}

describe('verified installer downloads', () => {
  it('extracts the matching checksum line', () => {
    expect(expectedInstallerHash(`${digest}  ${filename}\n`, filename)).toBe(digest)
    expect(() => expectedInstallerHash(`${digest}  other.exe\n`, filename)).toThrow(/没有/)
  })

  it('writes the installer only after SHA-256 verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'station-update-'))
    const fetchDownload = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`${digest}  ${filename}\n`, { status: 200 }))
      .mockResolvedValueOnce(new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.length) },
      }))
    const progress = vi.fn()
    const path = await downloadVerifiedInstaller(result(), {
      downloadDirectory: directory,
      fetchDownload,
      onProgress: progress,
    })
    await expect(readFile(path)).resolves.toEqual(payload)
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: payload.length, totalBytes: payload.length })
  })

  it('rejects an installer whose checksum does not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'station-update-bad-'))
    const fetchDownload = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`${'0'.repeat(64)}  ${filename}\n`, { status: 200 }))
      .mockResolvedValueOnce(new Response(payload, { status: 200 }))
    await expect(downloadVerifiedInstaller(result(), {
      downloadDirectory: directory,
      fetchDownload,
    })).rejects.toThrow(/校验失败/)
  })
})
