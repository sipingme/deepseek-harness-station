/** Filesystem paths that preserve DeepSeek Harness profile module resolution. */

import { join } from 'node:path'

/**
 * Place generation roots below the profile directory. Loader imports then walk
 * through profile-local node_modules and the installation fallback at
 * profiles/node_modules before reaching the filesystem root.
 */
export function generationWorkRoot(dshHome: string, profile: string): string {
  if (profile === '' || profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..') {
    throw new Error(`Invalid Harness profile name: ${JSON.stringify(profile)}`)
  }
  return join(dshHome, 'profiles', profile, '.station-generations')
}
