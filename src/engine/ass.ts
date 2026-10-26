import { blockEnd, blockStart, displayWord } from './captions'
import type { Range } from './silence'
import { mapRange } from './timeline'
import type { CaptionBlock, CaptionPreset, HookSettings } from './types'

/** #RRGGBB → ASS-Farbe &HAABBGGRR (AA = 00 deckend). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? m[1] : 'FFFFFF'
  const r = v.slice(0, 2)
  const g = v.slice(2, 4)
  const b = v.slice(4, 6)
  const a = Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, '0')
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

/** Inline-Farbe für Override-Tags: &HBBGGRR& */
function inlineColor(hex: string): string {
  return assColor(hex).replace(/^&H00/, '&H') + '&'
}

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

export function escapeAss(text: string): string {
  return text.replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, ' ')
}

export interface AssInput {
  width: number
  height: number
  preset: CaptionPreset
  captions: CaptionBlock[]
  captionsEnabled: boolean
  hook: HookSettings
  /** Behaltene Segmente; Untertitel werden auf die Ausgabezeit umgerechnet. */
  segments: Range[]
}

/**
 * libass rechnet die Schriftgröße auf die Zeilenhöhe (OS/2 winAscent + winDescent), der Browser auf das Em.
 * Damit Vorschau und Export gleich groß sind, sind Preset-Größen CSS-Pixel und werden hier umgerechnet.
 * Werte = unitsPerEm / (winAscent + winDescent) der mitgelieferten Schriften.
 */
const EM_PER_LINE: Record<string, number> = {
  Anton: 0.5769,
  'Montserrat Black': 0.6402,
  'Montserrat ExtraBold': 0.6402
}
const DEFAULT_EM_PER_LINE = 0.8

export function assFontSize(family: string, cssPx: number): number {
  return Math.round(cssPx / (EM_PER_LINE[family] ?? DEFAULT_EM_PER_LINE))
}

/** Lücken unter diesem Wert werden geschlossen, damit Untertitel nicht flackern. */
const BRIDGE_GAP_SEC = 0.3

export function buildAss(input: AssInput): string {
  const { width: W, height: H, preset: p } = input
  const scale = Math.min(W, H) / 1080
  const fs = assFontSize(p.fontFamily, p.fontSize * scale)
  const outline = round1(p.outlineWidth * scale)
  const shadow = round1(p.shadow * scale)
  const hk = p.hook
  const hookFs = assFontSize(hk.fontFamily, hk.fontSize * scale)
  const hookPad = Math.round(16 * scale)

  const lines: string[] = [
    '[Script Info]',
    '; JUSTZ Studio',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${p.fontFamily},${fs},${assColor(p.textColor)},${assColor(p.textColor)},${assColor(p.outlineColor)},${assColor('#000000', 0x60)},0,0,0,0,100,100,0,0,1,${outline},${shadow},5,${Math.round(70 * scale)},${Math.round(70 * scale)},0,1`,
    `Style: Hook,${hk.fontFamily},${hookFs},${assColor(hk.textColor)},${assColor(hk.textColor)},${assColor(hk.barColor)},${assColor(hk.barColor)},0,0,0,0,100,100,0,0,3,${hookPad},0,5,${Math.round(90 * scale)},${Math.round(90 * scale)},0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]

  if (input.hook.enabled && input.hook.text.trim()) {
    const text = escapeAss(hk.uppercase ? input.hook.text.toLocaleUpperCase('de-DE') : input.hook.text)
    const pos = `\\an5\\pos(${Math.round(W / 2)},${Math.round(hk.positionY * H)})`
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(input.hook.durationSec)},Hook,,0,0,0,,{${pos}\\fad(120,220)\\fscx85\\fscy85\\t(0,140,\\fscx100\\fscy100)}${text}`)
  }

  if (input.captionsEnabled) {
    const events = captionEvents(input)
    for (const e of events) lines.push(`Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Caption,,0,0,0,,${e.text}`)
  }
  return lines.join('\n') + '\n'
}

interface Event {
  start: number
  end: number
  text: string
}

function captionEvents(input: AssInput): Event[] {
  const { preset: p, width: W, height: H, segments } = input
  const pos = `\\an5\\pos(${Math.round(W / 2)},${Math.round(p.positionY * H)})`
  const pop = p.animation === 'pop' ? '\\fscx80\\fscy80\\t(0,90,\\fscx100\\fscy100)' : ''

  const mapped = input.captions
    .filter((b) => b.words.length > 0)
    .map((b) => ({ block: b, range: mapRange(segments, { start: blockStart(b), end: blockEnd(b) }) }))
    .filter((m): m is { block: CaptionBlock; range: Range } => m.range !== null && m.range.end - m.range.start > 0.02)
    .sort((a, b) => a.range.start - b.range.start)

  const events: Event[] = []
  mapped.forEach(({ block, range }, i) => {
    const next = mapped[i + 1]
    let end = range.end
    if (next && next.range.start - end < BRIDGE_GAP_SEC) end = next.range.start
    if (next && end > next.range.start) end = next.range.start

    const render = (active: number): string =>
      block.words
        .map((w, wi) => {
          const t = escapeAss(displayWord(w.text, p.uppercase))
          const color = wi === active && p.activeWordColor ? p.activeWordColor : w.keyword ? p.keywordColor : ''
          return color ? `{\\c${inlineColor(color)}}${t}{\\c${inlineColor(p.textColor)}}` : t
        })
        .join(' ')

    if (!p.activeWordColor) {
      events.push({ start: range.start, end, text: `{${pos}${pop}}${render(-1)}` })
      return
    }
    // Karaoke: ein Event pro Wort, das gesprochene Wort ist eingefärbt.
    const starts = block.words.map((w) => mapRange(segments, { start: w.start, end: w.end })?.start ?? range.start)
    starts.forEach((s, wi) => {
      const st = wi === 0 ? range.start : Math.max(range.start, s)
      const en = wi === starts.length - 1 ? end : Math.min(end, Math.max(st, starts[wi + 1]))
      if (en - st < 0.01) return
      events.push({ start: st, end: en, text: `{${pos}${wi === 0 ? pop : ''}}${render(wi)}` })
    })
  })
  return events
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
