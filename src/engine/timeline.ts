import type { Range } from './silence'
import type { Cut } from './types'

/** Teile des Quellvideos, die nach dem Schnitt übrig bleiben, sortiert. */
export function keepSegments(duration: number, cuts: Cut[], fps?: number): Range[] {
  const snap = (t: number): number => (fps ? Math.round(t * fps) / fps : t)
  const active = cuts
    .filter((c) => c.enabled)
    .map((c) => ({ start: Math.max(0, snap(c.start)), end: Math.min(duration, snap(c.end)) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start)

  const merged: Range[] = []
  for (const c of active) {
    const last = merged[merged.length - 1]
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end)
    else merged.push({ ...c })
  }

  const keep: Range[] = []
  let pos = 0
  for (const c of merged) {
    if (c.start > pos) keep.push({ start: pos, end: c.start })
    pos = Math.max(pos, c.end)
  }
  const end = fps ? Math.floor(duration * fps) / fps : duration
  if (end > pos) keep.push({ start: pos, end })
  const minLen = fps ? 1 / fps : 0.001
  return keep.filter((k) => k.end - k.start >= minLen - 1e-9)
}

export function outputDuration(segments: Range[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0)
}

/** Quellzeit → Ausgabezeit. Liegt t in einem Schnitt, wird auf den nächsten Segmentanfang gelegt. */
export function sourceToOutput(segments: Range[], t: number): number {
  let acc = 0
  for (const s of segments) {
    if (t < s.start) return acc
    if (t <= s.end) return acc + (t - s.start)
    acc += s.end - s.start
  }
  return acc
}

/** Ausgabezeit → Quellzeit. */
export function outputToSource(segments: Range[], t: number): number {
  let acc = 0
  for (const s of segments) {
    const len = s.end - s.start
    if (t <= acc + len) return s.start + (t - acc)
    acc += len
  }
  const last = segments[segments.length - 1]
  return last ? last.end : 0
}

/** Liegt die Quellzeit in einem aktiven Schnitt? Liefert dessen Ende (für die Vorschau zum Überspringen). */
export function cutAt(cuts: Cut[], t: number): Cut | undefined {
  return cuts.find((c) => c.enabled && t >= c.start && t < c.end - 0.01)
}

/**
 * Bildet einen Quellzeitraum auf die Ausgabe ab. Liegt er komplett in einem Schnitt, kommt null zurück.
 * Ragt er in einen Schnitt hinein, wird er auf den behaltenen Teil gekürzt.
 */
export function mapRange(segments: Range[], r: Range): Range | null {
  let start: number | null = null
  let end: number | null = null
  for (const s of segments) {
    const a = Math.max(s.start, r.start)
    const b = Math.min(s.end, r.end)
    if (b > a) {
      if (start === null) start = sourceToOutput(segments, a)
      end = sourceToOutput(segments, b)
    }
  }
  if (start === null || end === null) return null
  return { start, end }
}
