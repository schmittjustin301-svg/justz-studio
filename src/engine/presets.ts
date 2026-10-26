import type { CaptionPreset } from './types'

export const BRAND_RED = '#E01E26'

const JUSTZ_HOOK = {
  fontFamily: 'Anton',
  fontSize: 78,
  textColor: '#FFFFFF',
  barColor: BRAND_RED,
  positionY: 0.2,
  uppercase: true
}

export const DEFAULT_PRESETS: CaptionPreset[] = [
  {
    id: 'justz-standard',
    name: 'JUSTZ Standard',
    fontFamily: 'Anton',
    fontSize: 92,
    uppercase: true,
    textColor: '#FFFFFF',
    keywordColor: BRAND_RED,
    activeWordColor: '',
    outlineColor: '#000000',
    outlineWidth: 6,
    shadow: 0,
    positionY: 0.68,
    autoKeyword: true,
    animation: 'pop',
    maxWordsPerBlock: 3,
    hook: { ...JUSTZ_HOOK }
  },
  {
    id: 'rafael',
    name: 'Rafael',
    fontFamily: 'Anton',
    fontSize: 104,
    uppercase: true,
    textColor: '#FFFFFF',
    keywordColor: BRAND_RED,
    activeWordColor: '',
    outlineColor: '#000000',
    outlineWidth: 8,
    shadow: 2,
    positionY: 0.6,
    autoKeyword: true,
    animation: 'pop',
    maxWordsPerBlock: 3,
    hook: { ...JUSTZ_HOOK }
  },
  {
    id: 'clean-karaoke',
    name: 'Clean Karaoke',
    fontFamily: 'Montserrat Black',
    fontSize: 80,
    uppercase: false,
    textColor: '#FFFFFF',
    keywordColor: '#FFFFFF',
    activeWordColor: '#FFD400',
    outlineColor: '#000000',
    outlineWidth: 5,
    shadow: 3,
    positionY: 0.72,
    autoKeyword: false,
    animation: 'none',
    maxWordsPerBlock: 4,
    hook: { ...JUSTZ_HOOK, fontFamily: 'Montserrat Black', fontSize: 66, uppercase: false }
  }
]

/** Schriften, die mit der App ausgeliefert werden und beim Export sicher verfügbar sind. */
export const BUNDLED_FONTS = ['Anton', 'Montserrat Black', 'Montserrat ExtraBold']

export function findPreset(presets: CaptionPreset[], id: string): CaptionPreset {
  return presets.find((p) => p.id === id) ?? presets[0] ?? DEFAULT_PRESETS[0]
}

/** Ergänzt fehlende Felder (z. B. aus älteren gespeicherten Presets). */
export function normalizePreset(p: Partial<CaptionPreset> & { id: string; name: string }): CaptionPreset {
  const base = DEFAULT_PRESETS[0]
  return { ...base, ...p, hook: { ...base.hook, ...p.hook } }
}
