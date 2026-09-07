/** Release checks for the Electron shell backed by published GitHub Release assets. */

export const UPDATE_METADATA_URL =
  'https://api.github.com/repos/sipingme/deepseek-harness-station/releases?per_page=20'
export const RELEASES_BASE_URL =
  'https://github.com/sipingme/deepseek-harness-station/releases'
export const UPDATE_FEED_URL = `${RELEASES_BASE_URL}.atom`

const requestTimeoutMs = 15_000

type Version = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

type ReleaseAsset = {
  name: string
  browser_download_url: string
}

type ReleaseMetadata = {
  tag_name: string
  html_url: string
  draft?: boolean
  assets?: ReleaseAsset[]
}

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  installerFilename: string
  installerUrl: string
  checksumUrl: string
  updateAvailable: boolean
}

function parseVersion(value: string): Version {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (match === null) throw new Error(`Invalid application version: ${JSON.stringify(value)}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left.localeCompare(right)
}

export function compareVersions(leftValue: string, rightValue: string): number {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1
    }
    const compared = compareIdentifier(leftIdentifier, rightIdentifier)
    if (compared !== 0) return compared
  }
  return 0
}

function trustedGithubUrl(value: string, expectedPathPrefix: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined
    return url.pathname.startsWith(expectedPathPrefix) ? url.href : undefined
  } catch {
    return undefined
  }
}

function releaseCandidate(metadata: ReleaseMetadata): Omit<UpdateCheckResult, 'currentVersion' | 'updateAvailable'> | undefined {
  if (typeof metadata.tag_name !== 'string' || metadata.draft === true || !Array.isArray(metadata.assets)) return undefined
  const latestVersion = metadata.tag_name.trim().replace(/^v/, '')
  try {
    parseVersion(latestVersion)
  } catch {
    return undefined
  }
  const installerFilename = `DeepSeek-Harness-Station-${latestVersion}-x64-Setup.exe`
  const installer = metadata.assets.find(asset => asset?.name === installerFilename)
  const checksum = metadata.assets.find(asset => asset?.name === 'SHA256SUMS.txt')
  const pathPrefix = '/sipingme/deepseek-harness-station/'
  const releaseUrl = trustedGithubUrl(metadata.html_url, `${pathPrefix}releases/`)
  const installerUrl = installer === undefined
    ? undefined
    : trustedGithubUrl(installer.browser_download_url, `${pathPrefix}releases/download/`)
  const checksumUrl = checksum === undefined
    ? undefined
    : trustedGithubUrl(checksum.browser_download_url, `${pathPrefix}releases/download/`)
  if (releaseUrl === undefined || installerUrl === undefined || checksumUrl === undefined) return undefined
  return { latestVersion, releaseUrl, installerFilename, installerUrl, checksumUrl }
}

async function checkApi(
  currentVersion: string,
  fetchLatest: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  parseVersion(currentVersion)
  const response = await fetchLatest(UPDATE_METADATA_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`)
  const metadata: unknown = await response.json()
  if (!Array.isArray(metadata)) throw new Error('Update metadata does not contain a release list')
  const candidates = metadata
    .map(item => item !== null && typeof item === 'object' ? releaseCandidate(item as ReleaseMetadata) : undefined)
    .filter(candidate => candidate !== undefined)
    .sort((left, right) => compareVersions(right.latestVersion, left.latestVersion))
  const latest = candidates[0]
  if (latest === undefined) throw new Error('尚未发布可自动升级的 Windows 安装包')
  return {
    currentVersion,
    ...latest,
    updateAvailable: compareVersions(latest.latestVersion, currentVersion) > 0,
  }
}

/** The public Atom feed avoids the unauthenticated API's shared IP rate limit. */
export async function checkForUpdate(
  currentVersion: string,
  fetchLatest: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  parseVersion(currentVersion)
  try {
    return await checkApi(currentVersion, fetchLatest)
  } catch (apiError) {
    try {
      const response = await fetchLatest(UPDATE_FEED_URL, {
        cache: 'no-store', signal: AbortSignal.timeout(requestTimeoutMs),
      })
      if (!response.ok) throw new Error(`Release feed returned HTTP ${response.status}`)
      const feed = await response.text()
      const tags = [...new Set([...feed.matchAll(/\/releases\/tag\/(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)["<]/g)].map(match => match[1]!))]
        .sort((left, right) => compareVersions(right, left)).slice(0, 20)
      for (const tag of tags) {
        const version = tag.replace(/^v/, '')
        const base = `${RELEASES_BASE_URL}/download/${tag}`
        const filenames = [`DeepSeek-Harness-Station-${version}-x64-Setup.exe`, 'SHA256SUMS.txt']
        const assets = filenames.map(name => ({ name, browser_download_url: `${base}/${name}` }))
        const checks = await Promise.all(assets.map(asset => fetchLatest(asset.browser_download_url, {
          method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(requestTimeoutMs),
        })))
        if (checks.some(check => !check.ok)) continue
        const candidate = releaseCandidate({ tag_name: tag, html_url: `${RELEASES_BASE_URL}/tag/${tag}`, assets })
        if (candidate !== undefined) return {
          currentVersion, ...candidate, updateAvailable: compareVersions(version, currentVersion) > 0,
        }
      }
      throw new Error('Release feed has no complete Windows release')
    } catch {
      throw apiError
    }
  }
}
