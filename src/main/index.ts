import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import type { CaptionPreset, MediaInfo, Project } from '../engine/types'
import { PROJECT_EXTENSION } from '../engine/project'
import { analyzeMedia, cacheDirFor, probeMedia } from '../node/analysis'
import { exportProject, renderPreviewFrame } from '../node/exporter'
import { CancelledError } from '../node/proc'
import { loadProjectFile, saveProjectFile } from '../node/projectFile'
import { PresetStore } from '../node/presetStore'
import { detectTools, toolProblems, type Tools } from '../node/tools'
import { DEFAULT_MODEL, downloadModel, isModelInstalled, transcribe, WHISPER_MODELS } from '../node/whisper'
import type { AppSettings, EnvironmentInfo, MenuAction, ProgressEvent } from '../shared/api'
import { allowMedia, handleMediaProtocol, registerMediaScheme } from './mediaProtocol'

const here = dirname(fileURLToPath(import.meta.url))

registerMediaScheme()
app.setName('JUSTZ Studio')

const userData = (): string => app.getPath('userData')
const paths = {
  settings: () => join(userData(), 'settings.json'),
  presets: () => join(userData(), 'presets.json'),
  cache: () => join(userData(), 'cache'),
  models: () => join(userData(), 'models'),
  /** Im Entwicklungsmodus liegen die Ressourcen im Projekt, in der fertigen App unter Contents/Resources. */
  resources: () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'))
}

const DEFAULT_SETTINGS: AppSettings = {
  ffmpegPath: '',
  ffprobePath: '',
  whisperPath: '',
  whisperModel: DEFAULT_MODEL,
  language: 'de',
  exportDir: ''
}

let settings: AppSettings = { ...DEFAULT_SETTINGS }
let tools: Tools
let presets: PresetStore
let win: BrowserWindow | null = null
const jobs = new Map<string, AbortController>()

async function loadSettings(): Promise<void> {
  try {
    settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(await readFile(paths.settings(), 'utf8')) as Partial<AppSettings>) }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }
}

async function refreshTools(): Promise<void> {
  tools = await detectTools(join(paths.resources(), 'fonts'), {
    ffmpeg: settings.ffmpegPath || undefined,
    ffprobe: settings.ffprobePath || undefined,
    whisper: settings.whisperPath || undefined
  })
}

function findLogo(): string | null {
  const candidates = [join(paths.resources(), 'logo.png'), join(app.getAppPath(), 'logo.png')]
  const found = candidates.find((p) => existsSync(p))
  return found ? allowMedia(found) : null
}

function environment(): EnvironmentInfo {
  return {
    tools: { ...tools, problems: toolProblems(tools) },
    settings,
    models: WHISPER_MODELS.map((m) => ({ ...m, installed: isModelInstalled(paths.models(), m.id) })),
    logoUrl: findLogo(),
    version: app.getVersion()
  }
}

function progress(jobId: string, stage: string, fraction: number, message: string): void {
  const e: ProgressEvent = { jobId, stage, fraction, message }
  win?.webContents.send('progress', e)
}

/** Führt einen abbrechbaren Job aus und meldet Abbruch verständlich zurück. */
async function job<T>(jobId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  jobs.set(jobId, ctrl)
  try {
    return await fn(ctrl.signal)
  } catch (e) {
    if (e instanceof CancelledError || ctrl.signal.aborted) throw new Error('Abgebrochen')
    throw e
  } finally {
    jobs.delete(jobId)
  }
}

function registerIpc(): void {
  ipcMain.handle('env:get', () => environment())
  ipcMain.handle('env:saveSettings', async (_e, s: Partial<AppSettings>) => {
    settings = { ...settings, ...s }
    await mkdir(userData(), { recursive: true })
    await writeFile(paths.settings(), JSON.stringify(settings, null, 2), 'utf8')
    await refreshTools()
    return environment()
  })

  ipcMain.handle('dialog:video', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Video importieren',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'MP4', 'MOV'] }]
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('dialog:music', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Musik auswählen',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac', 'aiff', 'flac'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Ordner wählen', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:exportPath', async (_e, defaultName: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Video exportieren',
      defaultPath: join(settings.exportDir || app.getPath('videos'), defaultName),
      filters: [{ name: 'MP4-Video', extensions: ['mp4'] }]
    })
    return r.canceled ? null : r.filePath
  })

  ipcMain.handle('media:import', (_e, jobId: string, path: string) =>
    job(jobId, async (signal) => {
      progress(jobId, 'probe', 0, 'Video wird gelesen')
      const media = await probeMedia(tools, path)
      const a = await analyzeMedia(tools, media, paths.cache(), (stage, f) => progress(jobId, 'analyze', f, stage), signal)
      return { media, proxyUrl: allowMedia(a.proxyPath), envelope: { windowSec: a.envelope.windowSec, db: Array.from(a.envelope.db) } }
    })
  )

  ipcMain.handle('project:save', async (_e, project: Project, path: string | null) => {
    let target = path
    if (!target) {
      const r = await dialog.showSaveDialog(win!, {
        title: 'Projekt speichern',
        defaultPath: `${project.name || 'Projekt'}.${PROJECT_EXTENSION}`,
        filters: [{ name: 'JUSTZ-Projekt', extensions: [PROJECT_EXTENSION] }]
      })
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    await saveProjectFile(target, project)
    app.addRecentDocument(target)
    return target
  })
  ipcMain.handle('project:openDialog', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Projekt öffnen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JUSTZ-Projekt', extensions: [PROJECT_EXTENSION] }]
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('project:load', async (_e, path: string) => ({ project: await loadProjectFile(path), path }))

  ipcMain.handle('whisper:download', (_e, jobId: string, id: string) =>
    job(jobId, async (signal) => {
      await downloadModel(paths.models(), id, (f) => progress(jobId, 'download', f, 'Modell wird geladen'), signal)
      return environment()
    })
  )
  ipcMain.handle('whisper:transcribe', (_e, jobId: string, media: MediaInfo, language: string, model: string) =>
    job(jobId, async (signal) => {
      if (!tools.whisper) throw new Error('whisper.cpp wurde nicht gefunden. Installieren mit: brew install whisper-cpp')
      const a = await analyzeMedia(tools, media, paths.cache(), undefined, signal)
      progress(jobId, 'transcribe', 0, 'Transkription läuft')
      return transcribe({
        whisper: tools.whisper,
        modelsDir: paths.models(),
        model,
        language,
        wavPath: a.wavPath,
        workDir: cacheDirFor(paths.cache(), media),
        signal,
        onProgress: (f) => progress(jobId, 'transcribe', f, 'Transkription läuft')
      })
    })
  )

  ipcMain.handle('export:video', (_e, jobId: string, project: Project, preset: CaptionPreset, outPath: string) =>
    job(jobId, (signal) => exportProject(tools, project, preset, outPath, (p) => progress(jobId, p.stage, p.fraction, p.message), signal))
  )
  ipcMain.handle('export:frame', async (_e, project: Project, preset: CaptionPreset, sourceTime: number) => {
    const out = join(paths.cache(), `frame-${Date.now()}.jpg`)
    await mkdir(paths.cache(), { recursive: true })
    await renderPreviewFrame(tools, project, preset, sourceTime, out)
    const data = await readFile(out)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  })
  ipcMain.handle('job:cancel', (_e, jobId: string) => {
    jobs.get(jobId)?.abort()
  })

  ipcMain.handle('presets:list', () => presets.list())
  ipcMain.handle('presets:save', (_e, p: CaptionPreset) => presets.save(p))
  ipcMain.handle('presets:delete', (_e, id: string) => presets.remove(id))
  ipcMain.handle('shell:showInFolder', (_e, path: string) => shell.showItemInFolder(path))
}

function sendMenu(action: MenuAction): void {
  win?.webContents.send('menu', action)
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Ablage',
      submenu: [
        { label: 'Neues Projekt', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        { label: 'Öffnen …', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { type: 'separator' },
        { label: 'Speichern', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Speichern unter …', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('save-as') },
        { type: 'separator' },
        { label: 'Exportieren …', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export') },
        { label: 'Einstellungen …', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') }
      ]
    },
    { role: 'editMenu', label: 'Bearbeiten' },
    { role: 'viewMenu', label: 'Darstellung' },
    { role: 'windowMenu', label: 'Fenster' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const icon = join(paths.resources(), 'logo.png')
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0A0A0A',
    title: 'JUSTZ Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: existsSync(icon) ? nativeImage.createFromPath(icon) : undefined,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.on('closed', () => {
    win = null
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  handleMediaProtocol()
  await mkdir(userData(), { recursive: true })
  await loadSettings()
  await refreshTools()
  presets = new PresetStore(paths.presets())
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const c of jobs.values()) c.abort()
  if (process.platform !== 'darwin') app.quit()
})
