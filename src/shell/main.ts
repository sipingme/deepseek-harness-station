/** DSH Station Electron shell: native UI and supervision, never the Harness runtime. */

import { app, BrowserWindow, shell } from 'electron'
import { HostSupervisor } from './supervisor.ts'

const supervisor = new HostSupervisor()
let window: BrowserWindow | undefined
let quitting = false

function createWindow(origin: string): BrowserWindow {
  const trustedOrigin = new URL(origin).origin
  const browserWindow = new BrowserWindow({
    title: 'DSH Station',
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  browserWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== trustedOrigin) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
        void shell.openExternal(target.href)
      }
    } catch {
      // Malformed targets remain denied.
    }
    return { action: 'deny' }
  })
  browserWindow.once('ready-to-show', () => browserWindow.show())
  browserWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    browserWindow.hide()
  })
  return browserWindow
}

async function launch(): Promise<void> {
  const ready = await supervisor.start('web')
  window = createWindow(ready.origin)
  await window.loadURL(ready.origin)
}

async function quit(): Promise<void> {
  if (quitting) return
  quitting = true
  await supervisor.stop()
  window?.destroy()
  app.exit(0)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    window?.show()
    window?.focus()
  })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    void quit()
  })
  app.whenReady().then(launch).catch((cause: unknown) => {
    console.error(`dsh-station: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
    void quit()
  })
}
