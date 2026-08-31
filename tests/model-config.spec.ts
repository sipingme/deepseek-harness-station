import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATION_BASE_URL,
  DEFAULT_STATION_MODEL,
  STATION_NO_AUTH_HEADER,
  stationModelPatches,
  STATION_MODEL_PROVIDER,
} from '../src/host/model-config.js'

function environment(values: Record<string, string> = {}) {
  return { get: (name: string) => values[name] === undefined ? undefined : { value: values[name] } }
}

describe('Station model configuration', () => {
  it('registers the verified unauthenticated Qwen endpoint as the default', () => {
    expect(stationModelPatches(environment())).toEqual([
      {
        id: 'llm-pi-ai',
        config: {
          providers: {
            [STATION_MODEL_PROVIDER]: {
              displayName: 'Station Qwen',
              api: 'openai-completions',
              baseURL: DEFAULT_STATION_BASE_URL,
              headers: { Authorization: STATION_NO_AUTH_HEADER },
              models: [{
                id: DEFAULT_STATION_MODEL,
                name: DEFAULT_STATION_MODEL,
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
        config: { provider: STATION_MODEL_PROVIDER, model: DEFAULT_STATION_MODEL },
      },
    ])
  })

  it('honors layered environment overrides and only requires a key when one is supplied', () => {
    const patches = stationModelPatches(environment({
      LLM_MODEL_NAME: 'custom-model',
      LLM_BASE_URL: 'https://gateway.example/v1/',
      LLM_API_KEY: 'secret',
    }))
    expect(patches[0]?.config.providers[STATION_MODEL_PROVIDER]).toMatchObject({
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: 'LLM_API_KEY',
      models: [{ id: 'custom-model' }],
    })
    expect(patches[0]?.config.providers[STATION_MODEL_PROVIDER]).not.toHaveProperty('headers')
    expect(patches[1]?.config).toEqual({ provider: STATION_MODEL_PROVIDER, model: 'custom-model' })
  })

  it('rejects a malformed endpoint before Harness boots', () => {
    expect(() => stationModelPatches(environment({ LLM_BASE_URL: 'file:///tmp/model' }))).toThrow(/HTTP\(S\)/)
  })
})
