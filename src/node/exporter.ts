import { mkdtemp, mkdir, readdir, copyFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildAss } from '../engine/ass'
import {
  buildFilterGraph,
  encodeArgs,
  inputArgs,
  OUTPUT_SIZES,
  parseLoudnorm,
  parseProgressChunk,
  previewFrameArgs,
  type GraphInput
} from '../engine/render'
import { keepSegments, outputDuration, sourceToOutput } from '../engine/timeline'
import type { CaptionPreset, Project } from '../engine/types'
import { run } from './proc'
import { canTonemap, requireFfmpeg, type Tools } from './tools'

export interface ExportProgress {
  stage: 'prepare' | 'loudness' | 'encode' | 'done'
  fraction: number
  message: string
}

export interface ExportResult {
  outPath: string
  duration: number
  measuredLufs: number
}

/** Arbeitsordner mit ASS-Datei und Schriften. FFmpeg läuft darin, damit keine Pfade escaped werden müssen. */
async function prepareWorkDir(tools: Tools, project: Project, preset: CaptionPreset): Promise<{ dir: string; assFile: string | null }> {
  const dir = await mkdtemp(join(tmpdir(), 'justz-export-'))
  await mkdir(join(dir, 'fonts'))
  for (const f of await readdir(tools.fontsDir)) {
    if (/\.(ttf|otf)$/i.test(f)) await copyFile(join(tools.fontsDir, f), join(dir, 'fonts', f))
  }
  const needsAss = (project.captionsEnabled && project.captions.length > 0) || (project.hook.enabled && project.hook.text.trim() !== '')
  if (!needsAss || !project.media) return { dir, assFile: null }
  const { width, height } = OUTPUT_SIZES[project.format.aspect]
  const segments = keepSegments(project.media.duration, project.cuts, project.export.fps)
  const ass = buildAss({ width, height, preset, captions: project.captions, captionsEnabled: project.captionsEnabled, hook: project.hook, segments })
  await writeFile(join(dir, 'captions.ass'), ass, 'utf8')
  return { dir, assFile: 'captions.ass' }
}

export async function exportProject(
  tools: Tools,
  project: Project,
  preset: CaptionPreset,
  outPath: string,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal
): Promise<ExportResult> {
  const { ffmpeg } = requireFfmpeg(tools)
  const media = project.media
  if (!media) throw new Error('Kein Video im Projekt.')
  const segments = keepSegments(media.duration, project.cuts, project.export.fps)
  if (segments.length === 0) throw new Error('Nach dem Schnitt bleibt nichts übrig – Schnitte prüfen.')
  const duration = outputDuration(segments)
  const music = project.music.enabled && project.music.path ? project.music : null

  onProgress?.({ stage: 'prepare', fraction: 0, message: 'Vorbereiten' })
  const { dir, assFile } = await prepareWorkDir(tools, project, preset)
  try {
    const base: GraphInput = {
      media,
      segments,
      format: project.format,
      music,
      exportSettings: project.export,
      assFile,
      fontsDir: 'fonts',
      canTonemap: canTonemap(tools),
      loudnorm: null
    }

    // Durchgang 1: Lautheit messen (nur Ton, schnell).
    onProgress?.({ stage: 'loudness', fraction: 0, message: 'Lautheit wird gemessen' })
    const measure = await run(
      ffmpeg,
      ['-hide_banner', '-nostats', ...inputArgs(media, music), '-filter_complex', buildFilterGraph({ ...base, audioOnly: true }), '-map', '[aout]', '-f', 'null', '-'],
      { cwd: dir, signal }
    )
    const loudnorm = parseLoudnorm(measure.stderr)

    // Durchgang 2: Rendern mit exakter Normalisierung.
    await mkdir(dirname(outPath), { recursive: true })
    const args = ['-hide_banner', ...inputArgs(media, music), '-filter_complex', buildFilterGraph({ ...base, loudnorm }), ...encodeArgs(project.export, outPath)]
    await run(ffmpeg, args, {
      cwd: dir,
      signal,
      onStdout: (chunk) => {
        const t = parseProgressChunk(chunk)
        if (t !== null) onProgress?.({ stage: 'encode', fraction: Math.min(1, t / duration), message: 'Video wird gerendert' })
      }
    })
    onProgress?.({ stage: 'done', fraction: 1, message: 'Fertig' })
    return { outPath, duration, measuredLufs: Number(loudnorm.input_i) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Rendert ein einzelnes Bild mit allen Effekten an der Quellzeit `sourceTime`. */
export async function renderPreviewFrame(tools: Tools, project: Project, preset: CaptionPreset, sourceTime: number, outPath: string): Promise<string> {
  const { ffmpeg } = requireFfmpeg(tools)
  const media = project.media
  if (!media) throw new Error('Kein Video im Projekt.')
  const segments = keepSegments(media.duration, project.cuts, project.export.fps)
  const outputTime = sourceToOutput(segments, sourceTime)
  const { dir, assFile } = await prepareWorkDir(tools, project, preset)
  try {
    const args = previewFrameArgs({ media, format: project.format, assFile, fontsDir: 'fonts', canTonemap: canTonemap(tools) }, sourceTime, outputTime, outPath)
    await run(ffmpeg, ['-hide_banner', '-v', 'error', ...args], { cwd: dir })
    return outPath
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
