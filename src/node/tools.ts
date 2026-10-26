import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { run } from './proc'

/** Pfade und Fähigkeiten der externen Programme. */
export interface Tools {
  ffmpeg: string | null
  ffprobe: string | null
  whisper: string | null
  ffmpegVersion: string
  filters: string[]
  /** Ordner mit den TTF-Schriften für die Untertitel. */
  fontsDir: string
}

export interface ToolOverrides {
  ffmpeg?: string
  ffprobe?: string
  whisper?: string
}

/**
 * Aus dem Finder gestartete Mac-Apps kennen den Homebrew-PATH nicht, deshalb suchen wir zusätzlich
 * an den üblichen Orten (Apple Silicon: /opt/homebrew, Intel: /usr/local).
 */
const UNIX_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin']

/** Windows: whisper.cpp gibt es nur als ZIP – wir suchen in den Ordnern, die die README empfiehlt. */
const WINDOWS_DIRS = [
  'C:\\whisper',
  'C:\\whisper\\Release',
  'C:\\ffmpeg\\bin',
  // winget legt hier Verknüpfungen an (z. B. für Gyan.FFmpeg)
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links')
]

const IS_WINDOWS = process.platform === 'win32'
const EXTRA_DIRS = IS_WINDOWS ? WINDOWS_DIRS : UNIX_DIRS

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Homebrew-Formel "ffmpeg-full" (keg-only) bringt sicher libass + zimg mit – wird bevorzugt, falls installiert. */
const FFMPEG_FULL_DIRS = ['/opt/homebrew/opt/ffmpeg-full/bin', '/usr/local/opt/ffmpeg-full/bin']

export function findBinary(names: string[], override?: string, preferDirs: string[] = []): string | null {
  if (override && existsSync(override) && isExecutable(override)) return override
  const dirs = [...preferDirs, ...(process.env.PATH ?? '').split(delimiter), ...EXTRA_DIRS].filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      const p = join(dir, IS_WINDOWS ? `${name}.exe` : name)
      if (existsSync(p) && isExecutable(p)) return p
    }
  }
  return null
}

const NEEDED_FILTERS = ['subtitles', 'loudnorm', 'sidechaincompress', 'zscale', 'tonemap', 'select', 'aselect', 'asetnsamples']

export async function detectTools(fontsDir: string, overrides: ToolOverrides = {}): Promise<Tools> {
  const ffmpeg = findBinary(['ffmpeg'], overrides.ffmpeg, FFMPEG_FULL_DIRS)
  const ffprobe = findBinary(['ffprobe'], overrides.ffprobe, FFMPEG_FULL_DIRS)
  // Homebrew installiert whisper.cpp als `whisper-cli` (ältere Versionen: `whisper-cpp`).
  const whisper = findBinary(['whisper-cli', 'whisper-cpp'], overrides.whisper)
  let ffmpegVersion = ''
  let filters: string[] = []
  if (ffmpeg) {
    try {
      const v = await run(ffmpeg, ['-hide_banner', '-version'])
      ffmpegVersion = /ffmpeg version (\S+)/.exec(v.stdout)?.[1] ?? ''
      const f = await run(ffmpeg, ['-hide_banner', '-filters'])
      filters = NEEDED_FILTERS.filter((name) => new RegExp(`\\s${name}\\s`).test(f.stdout))
    } catch {
      // ffmpeg nicht lauffähig → wird in der UI als Problem angezeigt
    }
  }
  return { ffmpeg, ffprobe, whisper, ffmpegVersion, filters, fontsDir }
}

export interface ToolProblem {
  severity: 'error' | 'warning'
  message: string
}

export function toolProblems(t: Tools): ToolProblem[] {
  const p: ToolProblem[] = []
  const brew = !IS_WINDOWS
  if (!t.ffmpeg || !t.ffprobe)
    p.push({ severity: 'error', message: brew ? 'FFmpeg wurde nicht gefunden. Installieren mit: brew install ffmpeg' : 'FFmpeg wurde nicht gefunden. Installieren mit: winget install Gyan.FFmpeg – danach die App neu starten.' })
  else {
    for (const f of ['subtitles', 'loudnorm', 'sidechaincompress']) {
      if (!t.filters.includes(f)) p.push({ severity: 'error', message: `FFmpeg-Filter "${f}" fehlt. Bitte die volle Version installieren: ${brew ? 'brew install ffmpeg-full' : 'winget install Gyan.FFmpeg'}` })
    }
    if (!t.filters.includes('zscale')) p.push({ severity: 'warning', message: 'FFmpeg ohne zscale: iPhone-HDR-Videos wirken nach dem Export evtl. blass. Abhilfe: ' + (brew ? 'brew install ffmpeg-full' : 'winget install Gyan.FFmpeg') })
  }
  if (!t.whisper) p.push({ severity: 'warning', message: brew ? 'whisper.cpp nicht gefunden – Transkription nicht möglich. Installieren mit: brew install whisper-cpp' : 'whisper.cpp nicht gefunden – ZIP von GitHub nach C:\\whisper entpacken (siehe README) oder Pfad in den Einstellungen eintragen.' })
  return p
}

export function canTonemap(t: Tools): boolean {
  return t.filters.includes('zscale') && t.filters.includes('tonemap')
}

export function requireFfmpeg(t: Tools): { ffmpeg: string; ffprobe: string } {
  if (!t.ffmpeg || !t.ffprobe) throw new Error('FFmpeg wurde nicht gefunden. Installieren mit: brew install ffmpeg')
  return { ffmpeg: t.ffmpeg, ffprobe: t.ffprobe }
}
