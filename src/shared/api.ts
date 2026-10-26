// Schnittstelle zwischen Oberfläche (Renderer) und Hauptprozess. Nur Typen – keine Logik.
import type { CaptionPreset, MediaInfo, Project, Transcript } from '../engine/types'

export interface AppSettings {
  ffmpegPath: string
  ffprobePath: string
  whisperPath: string
  whisperModel: string
  language: 'de' | 'en' | 'auto'
  exportDir: string
}

export interface ToolStatus {
  ffmpeg: string | null
  ffprobe: string | null
  whisper: string | null
  ffmpegVersion: string
  filters: string[]
  problems: Array<{ severity: 'error' | 'warning'; message: string }>
}

export interface ModelStatus {
  id: string
  label: string
  sizeMb: number
  note: string
  installed: boolean
}

export interface EnvironmentInfo {
  tools: ToolStatus
  settings: AppSettings
  models: ModelStatus[]
  logoUrl: string | null
  version: string
}

export interface ImportResult {
  media: MediaInfo
  proxyUrl: string
  envelope: { windowSec: number; db: number[] }
}

export interface ProgressEvent {
  jobId: string
  stage: string
  fraction: number
  message: string
}

export interface ExportResultInfo {
  outPath: string
  duration: number
  measuredLufs: number
}

export interface JustzApi {
  getEnvironment(): Promise<EnvironmentInfo>
  saveSettings(s: Partial<AppSettings>): Promise<EnvironmentInfo>
  pathForFile(file: File): string
  chooseVideo(): Promise<string[]>
  chooseMusic(): Promise<string | null>
  chooseFolder(): Promise<string | null>
  chooseExportPath(defaultName: string): Promise<string | null>
  importMedia(jobId: string, path: string): Promise<ImportResult>
  saveProject(project: Project, path: string | null): Promise<string | null>
  openProjectDialog(): Promise<string[]>
  loadProject(path: string): Promise<{ project: Project; path: string }>
  downloadModel(jobId: string, id: string): Promise<EnvironmentInfo>
  transcribe(jobId: string, media: MediaInfo, language: string, model: string): Promise<Transcript>
  exportVideo(jobId: string, project: Project, preset: CaptionPreset, outPath: string): Promise<ExportResultInfo>
  previewFrame(project: Project, preset: CaptionPreset, sourceTime: number): Promise<string>
  cancel(jobId: string): Promise<void>
  listPresets(): Promise<CaptionPreset[]>
  savePreset(p: CaptionPreset): Promise<CaptionPreset[]>
  deletePreset(id: string): Promise<CaptionPreset[]>
  showInFolder(path: string): Promise<void>
  onProgress(cb: (e: ProgressEvent) => void): () => void
  onMenu(cb: (action: MenuAction) => void): () => void
}

export type MenuAction = 'new' | 'open' | 'save' | 'save-as' | 'export' | 'settings'
