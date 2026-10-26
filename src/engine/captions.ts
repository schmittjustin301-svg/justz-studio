import { newId } from './project'
import type { Range } from './silence'
import { mapRange } from './timeline'
import type { CaptionBlock, CaptionWord, Word } from './types'

export interface BlockOptions {
  maxWords: number
  minWords: number
  maxChars: number
  /** Ab dieser Sprechpause beginnt ein neuer Block. */
  maxGapSec: number
}

export const DEFAULT_BLOCK_OPTIONS: BlockOptions = { maxWords: 3, minWords: 2, maxChars: 22, maxGapSec: 0.6 }

const SENTENCE_END = /[.!?…]["»“]?$/
const CLAUSE_END = /[,;:–]$/

/**
 * Teilt die Wörter in Untertitel-Blöcke (2–4 Wörter). Wörter, die komplett in einem Schnitt liegen,
 * fallen weg, wenn `segments` übergeben wird.
 */
export function buildCaptionBlocks(words: Word[], opts: Partial<BlockOptions> = {}, segments?: Range[]): CaptionBlock[] {
  const o = { ...DEFAULT_BLOCK_OPTIONS, ...opts }
  const usable = segments ? words.filter((w) => mapRange(segments, w) !== null) : words
  const groups: CaptionWord[][] = []
  let cur: CaptionWord[] = []
  const chars = (ws: CaptionWord[]): number => ws.reduce((n, w) => n + w.text.length, 0) + Math.max(0, ws.length - 1)

  for (const w of usable) {
    const prev = cur[cur.length - 1]
    const breakBefore =
      cur.length > 0 &&
      (cur.length >= o.maxWords ||
        chars([...cur, w]) > o.maxChars ||
        w.start - prev.end > o.maxGapSec ||
        SENTENCE_END.test(prev.text) ||
        (CLAUSE_END.test(prev.text) && cur.length >= o.minWords) ||
        (segments !== undefined && crossesCut(segments, prev, w)))
    if (breakBefore) {
      groups.push(cur)
      cur = []
    }
    cur.push({ text: w.text, start: w.start, end: w.end })
  }
  if (cur.length) groups.push(cur)

  // Einzelwörter am Satzende vermeiden: ein Wort vom vorigen Block herüberholen.
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i]
    const prev = groups[i - 1]
    if (g.length === 1 && prev.length >= o.minWords + 1 && !SENTENCE_END.test(prev[prev.length - 1].text) && g[0].start - prev[prev.length - 1].end <= o.maxGapSec) {
      g.unshift(prev.pop()!)
    }
  }
  return groups.map((ws) => ({ id: newId('cap'), words: ws }))
}

function crossesCut(segments: Range[], a: Word, b: Word): boolean {
  const seg = segments.find((s) => a.end > s.start && a.start < s.end)
  return !!seg && b.start >= seg.end
}

const STOPWORDS = new Set(
  (
    'der die das den dem des ein eine einer eines einem einen und oder aber auch nicht nur noch schon sehr ' +
    'ich du er sie es wir ihr mich dich sich uns euch mein dein sein ihr unser euer mir dir ihm ihnen ' +
    'ist sind war waren bin bist hat haben hast habe wird werden wurde kann können muss müssen soll sollte ' +
    'mit von zu zum zur für auf aus bei nach über unter vor in im am an als wie wenn dass weil denn dann ' +
    'so was wer wo hier da dort jetzt mal halt eben einfach also ganz immer wirklich ' +
    'the a an and or but not only also very i you he she it we they me him her us them my your his its our their ' +
    'is are was were be been am have has had do does did will would can could should must to of in on at for ' +
    'with from by as if that this these those so what who where when how just really'
  ).split(' ')
)

export function cleanWord(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Markiert das aussagekräftigste Wort (längstes Nicht-Füllwort) als Schlüsselwort. */
export function autoKeyword(block: CaptionBlock): CaptionBlock {
  if (block.words.some((w) => w.keyword)) return block
  let best = -1
  let bestScore = 0
  block.words.forEach((w, i) => {
    const c = cleanWord(w.text)
    if (c.length < 4 || STOPWORDS.has(c.toLowerCase())) return
    const score = c.length + (/\d/.test(c) ? 4 : 0) + (/[!]$/.test(w.text) ? 2 : 0)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  if (best < 0) return block
  return { ...block, words: block.words.map((w, i) => (i === best ? { ...w, keyword: true } : w)) }
}

/** Text eines Blocks für den Editor; Schlüsselwörter stehen in *Sternchen*. */
export function blockToEditorText(block: CaptionBlock): string {
  return block.words.map((w) => (w.keyword ? `*${w.text}*` : w.text)).join(' ')
}

/**
 * Übernimmt korrigierten Text in einen Block. Das Timing des Blocks bleibt erhalten:
 * gleiche Wortzahl → Zeiten 1:1; sonst wird die Blockdauer nach Wortlänge aufgeteilt.
 */
export function applyEditorText(block: CaptionBlock, text: string): CaptionBlock {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { ...block, words: [] }
  const parsed = tokens.map((t) => {
    const m = /^\*(.+)\*$/.exec(t)
    return { text: m ? m[1] : t.replace(/\*/g, ''), keyword: !!m }
  })
  const old = block.words
  if (old.length === 0) return block
  if (parsed.length === old.length) {
    return { ...block, words: old.map((w, i) => ({ start: w.start, end: w.end, text: parsed[i].text, ...(parsed[i].keyword ? { keyword: true } : {}) })) }
  }
  const start = old[0].start
  const end = old[old.length - 1].end
  const weights = parsed.map((p) => Math.max(2, p.text.length))
  const total = weights.reduce((a, b) => a + b, 0)
  let t = start
  const words: CaptionWord[] = parsed.map((p, i) => {
    const len = ((end - start) * weights[i]) / total
    const w: CaptionWord = { text: p.text, start: round(t), end: round(i === parsed.length - 1 ? end : t + len) }
    if (p.keyword) w.keyword = true
    t += len
    return w
  })
  return { ...block, words }
}

export function blockStart(b: CaptionBlock): number {
  return b.words[0]?.start ?? 0
}

export function blockEnd(b: CaptionBlock): number {
  return b.words[b.words.length - 1]?.end ?? 0
}

/** Teilt einen Block vor dem Wort mit Index `at`. */
export function splitBlock(blocks: CaptionBlock[], id: string, at: number): CaptionBlock[] {
  return blocks.flatMap((b) => {
    if (b.id !== id || at <= 0 || at >= b.words.length) return [b]
    return [
      { id: b.id, words: b.words.slice(0, at) },
      { id: newId('cap'), words: b.words.slice(at) }
    ]
  })
}

export function mergeWithNext(blocks: CaptionBlock[], id: string): CaptionBlock[] {
  const i = blocks.findIndex((b) => b.id === id)
  if (i < 0 || i >= blocks.length - 1) return blocks
  const merged = { id: blocks[i].id, words: [...blocks[i].words, ...blocks[i + 1].words] }
  return [...blocks.slice(0, i), merged, ...blocks.slice(i + 2)]
}

export function toggleKeyword(block: CaptionBlock, index: number): CaptionBlock {
  return { ...block, words: block.words.map((w, i) => (i === index ? { ...w, keyword: !w.keyword } : w)) }
}

/** Anzeige-Text eines Worts: Komma/Punkt am Ende fallen in Reels-Untertiteln weg. */
export function displayWord(text: string, uppercase: boolean): string {
  const t = text.replace(/[,.;:]+$/, '')
  return uppercase ? t.toLocaleUpperCase('de-DE') : t
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
