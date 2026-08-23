# DeepSeek Harness Station repository rules

Station is a clean-room desktop product built on published DeepSeek Harness packages.

- Do not copy source code, tests, comments, or private implementation structure from other desktop wrappers.
- The Electron Shell owns native UI and Host supervision only.
- The independent Node Host owns the complete Cordis generation and its subprocess tree.
- Keep Shell-to-Host messages small, versioned, validated, and generation-scoped.
- Keep the Renderer sandboxed and restrict main-frame navigation to the active loopback origin.
- Extend Harness through published plugins and profile composition; do not patch upstream packages.
- Use Node.js `^22.19.0 || >=24.0.0` and pnpm 11.7.0 through Corepack.
- Run `corepack pnpm check` before claiming the project passes validation.
