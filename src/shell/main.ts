/** DeepSeek Harness Station Electron shell: native UI and Host supervision only. */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { HostSupervisor, type UnexpectedHostExit } from './supervisor.js'
import { generationWorkRoot } from './paths.js'
import { downloadVerifiedInstaller } from './installer-updater.js'
import { classifyWindowOpen } from './navigation-policy.js'
import { checkForUpdate, RELEASES_BASE_URL, type UpdateCheckResult } from './update-checker.js'

const PRODUCT_NAME = 'DeepSeek Harness Station'
const APP_ID = 'com.siping.deepseek-harness-station'
const harnessVersion = (createRequire(import.meta.url)('@deepseek-ai/dsh/package.json') as { version: string }).version
const smokeFile = process.env.STATION_SMOKE_FILE
const smokeHoldMs = Number(process.env.STATION_SMOKE_HOLD_MS ?? '0')
const recoveryLimit = 3
const recoveryWindowMs = 60_000
const updateCheckIntervalMs = 6 * 60 * 60 * 1_000
const initialUpdateCheckDelayMs = 10_000

let supervisor: HostSupervisor
let window: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
let recovering = false
let checkingForUpdate = false
let lastNotifiedVersion: string | undefined
const recoveryAttempts: number[] = []

function applicationIconPath(): string {
  const filename = process.platform === 'darwin' ? 'icon.png' : 'icon.ico'
  return app.isPackaged
    ? join(process.resourcesPath, filename)
    : join(app.getAppPath(), 'build-resources', filename)
}

function hostEntry(): string | undefined {
  if (!app.isPackaged) return undefined
  return join(process.resourcesPath, 'app.asar.unpacked', 'lib', 'host', 'main.js')
}

function showWindow(): void {
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function createWindow(origin: string): BrowserWindow {
  const trustedOrigin = new URL(origin).origin
  const browserWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    show: false,
    icon: applicationIconPath(),
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
    const disposition = classifyWindowOpen(trustedOrigin, url)
    if (disposition === 'internal') {
      if (url !== browserWindow.webContents.getURL()) void browserWindow.loadURL(url)
    } else if (disposition === 'external') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  if (smokeFile === undefined) browserWindow.once('ready-to-show', () => browserWindow.show())
  browserWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    browserWindow.hide()
  })
  return browserWindow
}

async function startAndLoad(): Promise<string> {
  const ready = await supervisor.start('web')
  if (window === undefined || window.isDestroyed()) window = createWindow(ready.origin)
  await window.loadURL(ready.launchUrl)
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      const text = document.body?.innerText ?? ''
      if (text.includes('Failed to load plugins')) {
        reject(new Error(text))
        return
      }
      if (document.querySelector('[data-shell-overlay]') !== null) {
        resolve(true)
        return
      }
      if (Date.now() - started >= 45_000) {
        reject(new Error('Renderer plugin activation timed out: ' + text.slice(0, 1000)))
        return
      }
      setTimeout(check, 100)
    }
    check()
  })`, true)
  return ready.origin
}

async function pickWorkspaceDirectory(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Select Workspace Directory',
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = window === undefined || window.isDestroyed()
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(window, options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

async function showUpdateResult(result: UpdateCheckResult, manual: boolean): Promise<void> {
  if (!result.updateAvailable) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本',
        detail: `DeepSeek Harness Station ${result.currentVersion}`,
        buttons: ['确定'],
      })
    }
    return
  }
  if (!manual && lastNotifiedVersion === result.latestVersion) return
  lastNotifiedVersion = result.latestVersion
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: '发现新版本',
    message: `DeepSeek Harness Station ${result.latestVersion} 已发布`,
    detail: `当前版本：${result.currentVersion}\n最新版本：${result.latestVersion}\n\n点击“下载并安装”后，下载完成并校验通过会自动启动安装程序，当前 App 随即退出。请先保存当前工作。`,
    buttons: ['下载并安装', '稍后提醒'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const response = window === undefined || window.isDestroyed()
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(window, options)
  if (response.response === 0) await downloadAndInstallUpdate(result)
}

async function downloadAndInstallUpdate(result: UpdateCheckResult): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      title: '下载更新',
      message: '当前环境不支持自动安装',
      detail: app.isPackaged ? '请从版本发布页下载安装包。' : '开发模式不会覆盖本地源码，请从安装版中测试自动升级。',
      buttons: ['打开版本发布页', '取消'],
      defaultId: 0,
      cancelId: 1,
    }).then(async response => {
      if (response.response === 0) await shell.openExternal(result.releaseUrl)
    })
    return
  }
  const targetWindow = window !== undefined && !window.isDestroyed() ? window : undefined
  targetWindow?.setProgressBar(2)
  tray?.setToolTip(`${PRODUCT_NAME} · 正在下载 ${result.latestVersion}`)
  try {
    const installerPath = await downloadVerifiedInstaller(result, {
      downloadDirectory: join(app.getPath('downloads'), 'DeepSeek Harness Station', result.latestVersion),
      onProgress: progress => {
        if (progress.totalBytes !== undefined) {
          targetWindow?.setProgressBar(progress.receivedBytes / progress.totalBytes)
        }
      },
    })
    targetWindow?.setProgressBar(-1)
    const installer = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    await once(installer, 'spawn')
    installer.unref()
    await quit()
  } catch (cause: unknown) {
    targetWindow?.setProgressBar(-1)
    await dialog.showMessageBox({
      type: 'error',
      title: '升级失败',
      message: '无法完成更新下载、校验或启动安装程序',
      detail: cause instanceof Error ? cause.message : String(cause),
      buttons: ['确定'],
    })
  } finally {
    if (!quitting) tray?.setToolTip(PRODUCT_NAME)
  }
}

async function runUpdateCheck(manual = false): Promise<void> {
  if (checkingForUpdate) return
  checkingForUpdate = true
  try {
    await showUpdateResult(await checkForUpdate(app.getVersion()), manual)
  } catch (cause: unknown) {
    console.warn(`deepseek-harness-station: update check failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    if (manual) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      await dialog.showMessageBox({
        type: 'warning',
        title: '检查更新失败',
        message: '暂时无法获取最新版本',
        detail: `${detail}\n\n可以打开版本发布页，手动下载安装更新。`,
        buttons: ['打开下载页面', '取消'],
        cancelId: 1,
      }).then(async response => {
        if (response.response === 0) await shell.openExternal(RELEASES_BASE_URL)
      })
    }
  } finally {
    checkingForUpdate = false
  }
}

function scheduleUpdateChecks(): void {
  const initial = setTimeout(() => { void runUpdateCheck() }, initialUpdateCheckDelayMs)
  const periodic = setInterval(() => { void runUpdateCheck() }, updateCheckIntervalMs)
  initial.unref()
  periodic.unref()
}

async function createDesktopShortcut(): Promise<void> {
  const ok = shell.writeShortcutLink(join(app.getPath('desktop'), `${PRODUCT_NAME}.lnk`), 'create', {
    target: process.execPath,
    cwd: dirname(process.execPath),
    icon: process.execPath,
    iconIndex: 0,
    appUserModelId: APP_ID,
    description: PRODUCT_NAME,
  })
  await dialog.showMessageBox({
    type: ok ? 'info' : 'error', title: '桌面快捷方式',
    message: ok ? '已创建桌面快捷方式' : '无法创建桌面快捷方式，请检查桌面目录是否可写。',
    buttons: ['确定'],
  })
}

async function uninstallApplication(): Promise<void> {
  const response = await dialog.showMessageBox({
    type: 'question', title: '卸载应用', message: `卸载 ${PRODUCT_NAME}？`,
    detail: '将退出当前 App 并打开卸载程序。只移除程序和快捷方式，保留会话、配置及工作区文件。请先保存当前工作。',
    buttons: ['卸载', '取消'], defaultId: 1, cancelId: 1, noLink: true,
  })
  if (response.response !== 0) return
  try {
    const uninstallerPath = join(dirname(process.execPath), `Uninstall ${PRODUCT_NAME}.exe`)
    await access(uninstallerPath)
    await supervisor.stop()
    const uninstaller = spawn(uninstallerPath, [], { detached: true, stdio: 'ignore', windowsHide: false })
    await once(uninstaller, 'spawn')
    uninstaller.unref()
    await quit()
  } catch (cause: unknown) {
    if (!supervisor.running) await restartHost()
    dialog.showErrorBox('无法打开卸载程序', `${cause instanceof Error ? cause.message : String(cause)}\n\n也可在 Windows 设置的“已安装的应用”中卸载。`)
  }
}

async function showVersionInfo(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '版本信息',
    message: PRODUCT_NAME,
    detail: `Station 版本：${app.getVersion()}\nDeepSeek Harness 版本：${harnessVersion}\n\n内置 Harness 随 Station 安装包更新。`,
    buttons: ['关闭'],
    noLink: true,
  })
}

function createTray(): void {
  const source = nativeImage.createFromPath(applicationIconPath())
  const icon = process.platform === 'darwin' ? source.resize({ width: 22, height: 22 }) : source
  tray = new Tray(icon)
  tray.setToolTip(PRODUCT_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 DeepSeek Harness Station', click: showWindow },
    { label: `当前版本 ${app.getVersion()}`, enabled: false },
    { label: '版本信息…', click: () => { void showVersionInfo() } },
    {
      label: '重新启动 Harness Host',
      click: () => { void restartHost() },
    },
    { label: '检查更新', click: () => { void runUpdateCheck(true) } },
    { type: 'separator' },
    { label: '退出', click: () => { void quit() } },
  ]))
  tray.on('double-click', showWindow)
}

function createApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '应用',
      submenu: [
        { label: '打开主窗口', click: showWindow },
        { label: '重新启动 Harness Host', click: () => { void restartHost() } },
        ...(process.platform === 'win32' && app.isPackaged ? [
          { label: '创建桌面快捷方式', click: () => { void createDesktopShortcut() } },
          { label: '卸载应用…', click: () => { void uninstallApplication() } },
        ] : []),
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载页面' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: `当前版本 ${app.getVersion()}`, enabled: false },
        { label: `DeepSeek Harness ${harnessVersion}`, enabled: false },
        { label: '版本信息…', click: () => { void showVersionInfo() } },
        { label: '检查更新…', click: () => { void runUpdateCheck(true) } },
        { label: '版本发布页', click: () => { void shell.openExternal('https://172.16.2.16/development/deepseek-harness-station/-/releases') } },
      ],
    },
  ]))
}

async function restartHost(): Promise<void> {
  if (quitting || recovering) return
  recovering = true
  try {
    await supervisor.stop()
    await startAndLoad()
    showWindow()
  } catch (cause: unknown) {
    dialog.showErrorBox('Harness Host 启动失败', cause instanceof Error ? cause.message : String(cause))
  } finally {
    recovering = false
  }
}

function recordRecoveryAttempt(): boolean {
  const now = Date.now()
  while ((recoveryAttempts[0] ?? now) < now - recoveryWindowMs) recoveryAttempts.shift()
  recoveryAttempts.push(now)
  return recoveryAttempts.length <= recoveryLimit
}

async function recoverHost(event: UnexpectedHostExit): Promise<void> {
  if (quitting || recovering) return
  recovering = true
  let lastError = `Host generation ${event.generationId} exited unexpectedly`
  try {
    while (!quitting && recordRecoveryAttempt()) {
      const delayMs = 500 * (2 ** Math.max(0, recoveryAttempts.length - 1))
      await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs))
      try {
        await startAndLoad()
        return
      } catch (cause: unknown) {
        lastError = cause instanceof Error ? cause.message : String(cause)
      }
    }
  } finally {
    recovering = false
  }
  if (!quitting) {
    dialog.showErrorBox('Harness Host 无法恢复', `${lastError}\n\n应用将在退出后保留您的用户配置。`)
    await quit()
  }
}

async function launch(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  const packagedHostEntry = hostEntry()
  supervisor = new HostSupervisor({
    ...(packagedHostEntry === undefined ? {} : { hostEntry: packagedHostEntry }),
    // Keep the generated root below the profile so Node's parent lookup reaches
    // profile-local plugins first, then the installation fallback at profiles/node_modules.
    workRoot: generationWorkRoot(resolveDshHome(), 'web'),
    pickDirectory: pickWorkspaceDirectory,
    onUnexpectedExit: event => { void recoverHost(event) },
  })
  if (smokeFile === undefined) {
    createApplicationMenu()
    createTray()
  }
  const origin = await startAndLoad()
  if (smokeFile === undefined) scheduleUpdateChecks()
  if (smokeFile !== undefined) {
    writeFileSync(smokeFile, `${JSON.stringify({ ok: true, origin, packaged: app.isPackaged, harnessVersion })}\n`, 'utf8')
    if (Number.isFinite(smokeHoldMs) && smokeHoldMs > 0) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, smokeHoldMs))
    }
    await quit()
  }
}

async function quit(): Promise<void> {
  if (quitting) return
  quitting = true
  if (supervisor !== undefined) await supervisor.stop()
  tray?.destroy()
  window?.destroy()
  app.exit(0)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, commandLine) => {
    const smokeArgument = commandLine.find(argument => argument.startsWith('--station-second-instance-smoke='))
    if (smokeArgument !== undefined) {
      writeFileSync(smokeArgument.slice('--station-second-instance-smoke='.length), 'focused\n', 'utf8')
    }
    showWindow()
  })
  app.on('activate', showWindow)
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    void quit()
  })
  app.whenReady().then(launch).catch((cause: unknown) => {
    console.error(`deepseek-harness-station: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
    if (smokeFile === undefined) {
      dialog.showErrorBox('DeepSeek Harness Station 启动失败', cause instanceof Error ? cause.message : String(cause))
    }
    void quit()
  })
}
