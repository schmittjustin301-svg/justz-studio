import { newId } from './project'
import type { Cut, SilenceSettings } from './types'

/** Lautstärkeverlauf des Tons: ein dBFS-Wert pro Fenster. */
export interface Envelope {
  windowSec: number
  db: Float32Array
}

export const ENVELOPE_WINDOW_SEC = 0.01
export const ANALYSIS_SAMPLE_RATE = 16000
const FLOOR_DB = -100

/** RMS-Pegel pro Fenster aus 16-bit-Mono-PCM. */
export function computeEnvelope(samples: Int16Array, sampleRate: number, windowSec = ENVELOPE_WINDOW_SEC): Envelope {
  const win = Math.max(1, Math.round(sampleRate * windowSec))
  const count = Math.ceil(samples.length / win)
  const db = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const from = i * win
    const to = Math.min(samples.length, from + win)
    let sum = 0
    for (let j = from; j < to; j++) {
      const v = samples[j] / 32768
      sum += v * v
    }
    const rms = Math.sqrt(sum / Math.max(1, to - from))
    db[i] = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB
  }
  return { windowSec: win / sampleRate, db }
}

/** Sinnvoller Startwert für die Schwelle: ein Stück über dem Grundrauschen der Aufnahme. */
export function suggestThreshold(env: Envelope): number {
  const sorted = Array.from(env.db).filter((v) => v > FLOOR_DB).sort((a, b) => a - b)
  if (sorted.length === 0) return -40
  const noise = sorted[Math.floor(sorted.length * 0.1)]
  const speech = sorted[Math.floor(sorted.length * 0.7)]
  const t = noise + Math.max(6, (speech - noise) * 0.35)
  return Math.round(Math.min(-20, Math.max(-60, t)))
}

/** Kurze Geräusche (Klicks, Schmatzer) in einer Pause zählen nicht als Sprache. */
const MIN_SOUND_SEC = 0.08
/** Kürzere Schnitte bringen nichts und erzeugen nur Ruckler. */
const MIN_CUT_SEC = 0.1

export interface Range {
  start: number
  end: number
}

export function detectSilences(env: Envelope, duration: number, s: Pick<SilenceSettings, 'thresholdDb' | 'minPauseSec'>): Range[] {
  const n = env.db.length
  const loud = new Uint8Array(n)
  for (let i = 0; i < n; i++) loud[i] = env.db[i] >= s.thresholdDb ? 1 : 0

  // Kurze laute Ausreißer wegfiltern.
  const minSound = Math.max(1, Math.round(MIN_SOUND_SEC / env.windowSec))
  for (let i = 0; i < n; ) {
    if (!loud[i]) {
      i++
      continue
    }
    let j = i
    while (j < n && loud[j]) j++
    if (j - i < minSound) loud.fill(0, i, j)
    i = j
  }

  const out: Range[] = []
  for (let i = 0; i < n; ) {
    if (loud[i]) {
      i++
      continue
    }
    let j = i
    while (j < n && !loud[j]) j++
    const start = i * env.windowSec
    const end = Math.min(duration, j * env.windowSec)
    if (end - start >= s.minPauseSec) out.push({ start, end })
    i = j
  }
  return out
}

/** Macht aus erkannten Pausen Schnitte, mit etwas Luft zum Gesprochenen. */
export function silencesToCuts(silences: Range[], duration: number, paddingSec: number): Range[] {
  const eps = 0.02
  const cuts: Range[] = []
  for (const s of silences) {
    const start = s.start <= eps ? 0 : s.start + paddingSec
    const end = s.end >= duration - eps ? duration : s.end - paddingSec
    if (end - start >= MIN_CUT_SEC) cuts.push({ start: round3(start), end: round3(end) })
  }
  return cuts
}

function overlap(a: Range, b: Range): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/**
 * Erzeugt die Schnittliste neu und übernimmt dabei manuell ausgeschaltete Schnitte:
 * ein neuer Schnitt bleibt aus, wenn er sich überwiegend mit einem vorher ausgeschalteten deckt.
 */
export function buildCuts(env: Envelope, duration: number, settings: SilenceSettings, previous: Cut[] = []): Cut[] {
  const ranges = silencesToCuts(detectSilences(env, duration, settings), duration, settings.paddingSec)
  const disabled = previous.filter((c) => !c.enabled)
  return ranges.map((r) => {
    const len = r.end - r.start
    const off = disabled.some((d) => overlap(d, r) >= 0.5 * Math.min(len, d.end - d.start))
    return { id: newId('cut'), start: round3(r.start), end: round3(r.end), enabled: !off }
  })
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Spitzenwerte für die Waveform-Anzeige (0–1), auf `buckets` Spalten verdichtet. */
export function waveformPeaks(env: Envelope, buckets: number, floorDb = -60): Float32Array {
  const out = new Float32Array(buckets)
  const per = env.db.length / buckets
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per)
    const to = Math.max(from + 1, Math.floor((b + 1) * per))
    let max = FLOOR_DB
    for (let i = from; i < to && i < env.db.length; i++) if (env.db[i] > max) max = env.db[i]
    out[b] = Math.max(0, Math.min(1, (max - floorDb) / -floorDb))
  }
  return out
}
