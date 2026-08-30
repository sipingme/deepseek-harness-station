import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      'host/main': 'src/host/main.ts',
      'host/workspace': 'src/host/workspace.ts',
      'shell/main': 'src/shell/main.ts',
      'shell/paths': 'src/shell/paths.ts',
      'shell/supervisor': 'src/shell/supervisor.ts',
      protocol: 'src/protocol.ts',
    },
    outDir: 'lib',
    platform: 'node',
    format: 'esm',
    target: 'es2024',
    sourcemap: false,
    outExtensions: () => ({ js: '.js' }),
    clean: true,
    dts: false,
    external: ['electron'],
  },
])
