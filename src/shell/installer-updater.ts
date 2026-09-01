/** Download and verify a Windows installer before handing it to the native shell. */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateCheckResult } from './update-checker.js'

const downloadTimeoutMs = 10 * 60 * 1_000

export type DownloadProgress = {
  receivedBytes: number
  totalBytes?: number
}

export type DownloadInstallerOptions = {
  downloadDirectory: string
  fetchDownload?: typeof fetch
  onProgress?: (progress: DownloadProgress) => void
}

export function expectedInstallerHash(checksumText: string, installerFilename: string): string {
  for (const line of checksumText.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim())
    if (match?.[2] === installerFilename) return match[1]!.toLowerCase()
  }
  throw new Error(`SHA-256 校验文件中没有 ${installerFilename}`)
}

async function fetchChecked(url: string, fetchDownload: typeof fetch): Promise<Response> {
  const response = await fetchDownload(url, {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(downloadTimeoutMs),
  })
  if (!response.ok) throw new Error(`更新服务器返回 HTTP ${response.status}`)
  return response
}

export async function downloadVerifiedInstaller(
  result: UpdateCheckResult,
  options: DownloadInstallerOptions,
): Promise<string> {
  if (!/^[0-9A-Za-z._-]+\.exe$/.test(result.installerFilename)) {
    throw new Error('安装包文件名不安全')
  }
  const fetchDownload = options.fetchDownload ?? fetch
  const checksumResponse = await fetchChecked(result.checksumUrl, fetchDownload)
  const expectedHash = expectedInstallerHash(await checksumResponse.text(), result.installerFilename)
  const installerResponse = await fetchChecked(result.installerUrl, fetchDownload)
  if (installerResponse.body === null) throw new Error('更新服务器没有返回安装包内容')

  await mkdir(options.downloadDirectory, { recursive: true })
  const installerPath = join(options.downloadDirectory, result.installerFilename)
  const partialPath = `${installerPath}.part`
  await rm(partialPath, { force: true })
  await rm(installerPath, { force: true })

  const totalHeader = Number(installerResponse.headers.get('content-length') ?? '')
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined
  const hash = createHash('sha256')
  const writer = createWriteStream(partialPath, { flags: 'wx' })
  const reader = installerResponse.body.getReader()
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      hash.update(chunk)
      receivedBytes += chunk.length
      if (!writer.write(chunk)) await once(writer, 'drain')
      options.onProgress?.({ receivedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) })
    }
    writer.end()
    await once(writer, 'finish')
    const actualHash = hash.digest('hex')
    if (actualHash !== expectedHash) {
      throw new Error(`安装包 SHA-256 校验失败：期望 ${expectedHash}，实际 ${actualHash}`)
    }
    await rename(partialPath, installerPath)
    return installerPath
  } catch (cause: unknown) {
    writer.destroy()
    await rm(partialPath, { force: true })
    throw cause
  } finally {
    reader.releaseLock()
  }
}
