import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      'host/main': 'src/host/main.ts',
      'shell/main': 'src/shell/main.ts',
      'shell/supervisor': 'src/shell/supervisor.ts',
      protocol: 'src/protocol.ts',
    },
    outDir: 'lib',
    platform: 'node',
    format: 'esm',
    target: 'es2024',
    sourcemap: true,
    clean: true,
    dts: false,
    external: ['electron'],
  },
])
