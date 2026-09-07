import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('allows a progressing download to take longer than ten minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), delay)
      return controller.signal
    })
    const directory = await mkdtemp(join(tmpdir(), 'station-update-slow-'))
    let signal: AbortSignal | undefined
    let part = 0
    const fetchDownload = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`${digest}  ${filename}\n`))
      .mockImplementationOnce(async (_url, init) => {
        signal = init?.signal ?? undefined
        return new Response(new ReadableStream({
          pull(controller) {
            if (part === 0) controller.enqueue(payload.subarray(0, 8))
            else if (part === 1) controller.enqueue(payload.subarray(8))
            else controller.close()
            part += 1
          },
        }))
      })
    const path = await downloadVerifiedInstaller(result(), {
      downloadDirectory: directory, fetchDownload,
      onProgress: () => {
        vi.advanceTimersByTime(6 * 60_000)
        expect(signal?.aborted).toBe(false)
      },
    })
    await expect(readFile(path)).resolves.toEqual(payload)
  })

  it('aborts an installer request after ten minutes without progress', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const directory = await mkdtemp(join(tmpdir(), 'station-update-stalled-'))
    const requested = Promise.withResolvers<void>()
    const fetchDownload = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`${digest}  ${filename}\n`))
      .mockImplementationOnce(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        requested.resolve()
      }))
    const download = downloadVerifiedInstaller(result(), { downloadDirectory: directory, fetchDownload })
    const rejected = expect(download).rejects.toThrow(/没有进展/)
    await requested.promise
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await rejected
  })
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
