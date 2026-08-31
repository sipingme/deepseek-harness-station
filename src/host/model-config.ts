import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

export const STATION_MODEL_PROVIDER = 'station-qwen'
export const DEFAULT_STATION_MODEL = 'Qwen3.8-27B-FP8'
export const DEFAULT_STATION_BASE_URL = 'http://172.16.144.161:8000/v1'
export const STATION_NO_AUTH_HEADER = 'Bearer station-no-auth'

interface EnvironmentLookup {
  get(name: string): { readonly value: string } | undefined
}

function optionalValue(environment: EnvironmentLookup, name: string): string | undefined {
  const value = environment.get(name)?.value.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

function modelBaseUrl(environment: EnvironmentLookup): string {
  const raw = optionalValue(environment, 'LLM_BASE_URL') ?? DEFAULT_STATION_BASE_URL
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`LLM_BASE_URL must be an absolute HTTP(S) URL: ${raw}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.search.length > 0
    || parsed.hash.length > 0) {
    throw new Error(`LLM_BASE_URL must be an absolute HTTP(S) URL without credentials, query, or fragment: ${raw}`)
  }
  return raw.replace(/\/+$/, '')
}

/** Station-owned defaults. Harness settings and the user's patch layer apply above them. */
export function stationModelPatches(environment: EnvironmentLookup): PatchOptions[] {
  const model = optionalValue(environment, 'LLM_MODEL_NAME') ?? DEFAULT_STATION_MODEL
  const apiKey = optionalValue(environment, 'LLM_API_KEY')
  return [
    {
      id: 'llm-pi-ai',
      config: {
        providers: {
          [STATION_MODEL_PROVIDER]: {
            displayName: 'Station Qwen',
            api: 'openai-completions',
            baseURL: modelBaseUrl(environment),
            ...(apiKey === undefined
              // pi-ai's OpenAI client requires either a key or Authorization
              // header even when the target server deliberately has auth off.
              ? { headers: { Authorization: STATION_NO_AUTH_HEADER } }
              : { apiKeyEnv: 'LLM_API_KEY' }),
            models: [{
              id: model,
              name: model,
              contextWindow: 262_144,
              maxTokens: 32_768,
            }],
            streamIdleTimeoutMs: 300_000,
          },
        },
      },
    },
    {
      id: 'agent-default-model',
      config: {
        provider: STATION_MODEL_PROVIDER,
        model,
      },
    },
  ]
}
