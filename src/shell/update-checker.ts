/** Lightweight release checks for the Electron shell. */

export const UPDATE_METADATA_URL =
  'https://raw.githubusercontent.com/sipingme/deepseek-harness-station/main/package.json'
export const RELEASES_BASE_URL =
  'https://172.16.2.16/development/deepseek-harness-station/-/releases'

const requestTimeoutMs = 15_000

type Version = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
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

export async function checkForUpdate(
  currentVersion: string,
  fetchLatest: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const response = await fetchLatest(UPDATE_METADATA_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`)
  const metadata: unknown = await response.json()
  if (metadata === null || typeof metadata !== 'object' || !('version' in metadata)
    || typeof metadata.version !== 'string') {
    throw new Error('Update metadata does not contain a version')
  }
  const latestVersion = metadata.version.trim()
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0
  return {
    currentVersion,
    latestVersion,
    releaseUrl: `${RELEASES_BASE_URL}/v${encodeURIComponent(latestVersion)}`,
    updateAvailable,
  }
}
