module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    const { verifyPackagedRuntime } = await import('./verify-runtime.mjs')
    await verifyPackagedRuntime(context.appOutDir)
  } else if (context.electronPlatformName === 'darwin') {
    const { verifyPackagedMacRuntime } = await import('./verify-mac-runtime.mjs')
    await verifyPackagedMacRuntime(context.appOutDir)
  }
}
