import type { Word } from './types'

/** Ausgabe von `whisper-cli -oj -ml 1 -sow`: ein Eintrag pro Wort. */
export interface WhisperCppJson {
  result?: { language?: string }
  transcription?: Array<{
    offsets?: { from: number; to: number }
    text?: string
    tokens?: Array<{ p?: number }>
  }>
}

/** Nicht-Sprache wie "[Musik]", "(lacht)", "*Applaus*" sowie Whisper-Steuertokens. */
const NON_SPEECH = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+)\s*$/

export function parseWhisperCppJson(json: WhisperCppJson): { language: string; words: Word[] } {
  const words: Word[] = []
  for (const seg of json.transcription ?? []) {
    const raw = seg.text ?? ''
    if (!raw.trim() || NON_SPEECH.test(raw)) continue
    const start = (seg.offsets?.from ?? 0) / 1000
    const end = (seg.offsets?.to ?? 0) / 1000
    const probs = (seg.tokens ?? []).map((t) => t.p).filter((p): p is number => typeof p === 'number')
    const p = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : undefined
    const prev = words[words.length - 1]
    // Teilstücke ohne führendes Leerzeichen gehören zum vorigen Wort (z. B. Satzzeichen, Wortteile).
    if (prev && !/^\s/.test(raw)) {
      prev.text += raw.trim()
      prev.end = Math.max(prev.end, end)
      continue
    }
    words.push({ text: raw.trim(), start, end, ...(p !== undefined ? { p } : {}) })
  }
  return { language: json.result?.language ?? 'auto', words: normalizeWords(words) }
}

/** Sorgt für aufsteigende, nicht überlappende Zeiten mit Mindestlänge. */
export function normalizeWords(words: Word[]): Word[] {
  const out: Word[] = []
  for (const w of words) {
    const prevEnd = out.length ? out[out.length - 1].end : 0
    const start = Math.max(w.start, prevEnd)
    const end = Math.max(w.end, start + 0.05)
    out.push({ ...w, start: round(start), end: round(end) })
  }
  return out
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function transcriptText(words: Word[]): string {
  return words.map((w) => w.text).join(' ')
}
