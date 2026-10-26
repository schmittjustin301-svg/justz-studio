import {
  autoKeyword,
  buildCaptionBlocks,
  buildCuts,
  createProject,
  keepSegments,
  suggestThreshold,
  type CaptionPreset,
  type Envelope,
  type Project,
  type Transcript
} from '../engine'
import type { ImportResult } from '../shared/api'
import { baseName } from './api'

export function toEnvelope(r: ImportResult['envelope']): Envelope {
  return { windowSec: r.windowSec, db: Float32Array.from(r.db) }
}

/** Neues Projekt aus einem importierten Video: Schwelle schätzen und Pausen schneiden. */
export function projectFromImport(r: ImportResult, preset: CaptionPreset): Project {
  const p = createProject(baseName(r.media.path))
  p.media = r.media
  p.presetId = preset.id
  p.export.fps = r.media.fps > 40 ? 60 : 30
  if (r.media.hasAudio) {
    const env = toEnvelope(r.envelope)
    p.silence.thresholdDb = suggestThreshold(env)
    p.cuts = buildCuts(env, r.media.duration, p.silence)
  }
  return p
}

/** Baut die Untertitel-Blöcke aus dem Transkript (aktuelle Schnitte + Preset werden berücksichtigt). */
export function captionsFromTranscript(p: Project, transcript: Transcript, preset: CaptionPreset): Project {
  const segments = p.media ? keepSegments(p.media.duration, p.cuts) : undefined
  let blocks = buildCaptionBlocks(transcript.words, { maxWords: preset.maxWordsPerBlock }, segments)
  if (preset.autoKeyword) blocks = blocks.map(autoKeyword)
  return { ...p, transcript, captions: blocks }
}
