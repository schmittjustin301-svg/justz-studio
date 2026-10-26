import { describe, expect, it } from 'vitest'
import {
  applyEditorText,
  assColor,
  assFontSize,
  assTime,
  autoKeyword,
  blockToEditorText,
  buildAss,
  buildCaptionBlocks,
  buildCuts,
  computeEnvelope,
  createProject,
  cropRect,
  DEFAULT_PRESETS,
  detectSilences,
  keepSegments,
  mapRange,
  outputDuration,
  outputToSource,
  parseLoudnorm,
  parseProbe,
  parseProject,
  parseWhisperCppJson,
  selectExpr,
  serializeProject,
  silencesToCuts,
  sourceToOutput,
  type Cut,
  type Envelope,
  type Word
} from '../src/engine'

function envFrom(spec: Array<[number, number, number]>, windowSec = 0.01): Envelope {
  // spec: [start, end, dB]
  const end = Math.max(...spec.map((s) => s[1]))
  const db = new Float32Array(Math.round(end / windowSec))
  db.fill(-90)
  for (const [a, b, v] of spec) for (let i = Math.round(a / windowSec); i < Math.round(b / windowSec); i++) db[i] = v
  return { windowSec, db }
}

describe('media', () => {
  it('erkennt iPhone-Hochkant (Rotation) und HDR', () => {
    const info = parseProbe(
      '/x.mov',
      {
        streams: [
          { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, avg_frame_rate: '60/1', color_transfer: 'arib-std-b67', side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] },
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' }
        ],
        format: { duration: '12.5' }
      },
      { size: 1, mtimeMs: 1 }
    )
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
    expect(info.rotation).toBe(270)
    expect(info.fps).toBe(60)
    expect(info.hdr).toBe(true)
    expect(info.hasAudio).toBe(true)
  })

  it('lehnt Dateien ohne Video ab', () => {
    expect(() => parseProbe('/a.mp3', { streams: [{ codec_type: 'audio' }], format: { duration: '3' } }, { size: 1, mtimeMs: 1 })).toThrow(/keine Videospur/)
  })
})

describe('Pausenerkennung', () => {
  it('berechnet den Pegel aus PCM', () => {
    const s = new Int16Array(1600)
    for (let i = 0; i < 800; i++) s[i] = Math.round(Math.sin(i / 3) * 16384)
    const env = computeEnvelope(s, 16000)
    expect(env.db.length).toBe(10)
    expect(env.db[0]).toBeGreaterThan(-12)
    expect(env.db[9]).toBe(-100)
  })

  it('findet Pausen ab Mindestlänge und ignoriert kurze Klicks', () => {
    const env = envFrom([
      [0, 1, -20],
      [1.5, 1.53, -15], // Klick in der Pause
      [2, 3, -20],
      [3.2, 4, -20]
    ])
    const s = detectSilences(env, 4, { thresholdDb: -40, minPauseSec: 0.4 })
    expect(s).toHaveLength(1)
    expect(s[0].start).toBeCloseTo(1, 2)
    expect(s[0].end).toBeCloseTo(2, 2)
  })

  it('lässt Luft am Schnitt, aber nicht am Anfang/Ende des Videos', () => {
    const cuts = silencesToCuts(
      [
        { start: 0, end: 0.8 },
        { start: 2, end: 3 },
        { start: 9, end: 10 }
      ],
      10,
      0.1
    )
    expect(cuts).toEqual([
      { start: 0, end: 0.7 },
      { start: 2.1, end: 2.9 },
      { start: 9.1, end: 10 }
    ])
  })

  it('behält manuell ausgeschaltete Schnitte bei Neuberechnung', () => {
    const env = envFrom([
      [0, 1, -20],
      [2, 3, -20],
      [4, 5, -20]
    ])
    const settings = { thresholdDb: -40, minPauseSec: 0.4, paddingSec: 0.1 }
    const first = buildCuts(env, 5, settings)
    expect(first).toHaveLength(2)
    first[1].enabled = false
    const again = buildCuts(env, 5, { ...settings, paddingSec: 0.05 }, first)
    expect(again.map((c) => c.enabled)).toEqual([true, false])
  })
})

describe('Timeline', () => {
  const cuts: Cut[] = [
    { id: 'a', start: 1, end: 2, enabled: true },
    { id: 'b', start: 3, end: 3.5, enabled: false },
    { id: 'c', start: 4, end: 5, enabled: true }
  ]

  it('bildet Segmente und rechnet Zeiten um', () => {
    const seg = keepSegments(6, cuts)
    expect(seg).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
      { start: 5, end: 6 }
    ])
    expect(outputDuration(seg)).toBe(4)
    expect(sourceToOutput(seg, 2.5)).toBeCloseTo(1.5)
    expect(sourceToOutput(seg, 1.5)).toBeCloseTo(1) // im Schnitt → nächster Segmentanfang
    expect(outputToSource(seg, 3.5)).toBeCloseTo(5.5)
  })

  it('rastet Segmente auf das Bildraster ein', () => {
    const seg = keepSegments(2, [{ id: 'x', start: 0.51, end: 1.012, enabled: true }], 30)
    expect(seg[0].end * 30).toBeCloseTo(Math.round(0.51 * 30))
    expect(seg[1].start * 30).toBeCloseTo(Math.round(1.012 * 30))
  })

  it('kürzt Bereiche, die in einen Schnitt ragen', () => {
    const seg = keepSegments(6, cuts)
    expect(mapRange(seg, { start: 0.8, end: 2.2 })).toEqual({ start: 0.8, end: expect.closeTo(1.2, 5) })
    expect(mapRange(seg, { start: 1.2, end: 1.8 })).toBeNull()
  })

  it('erzeugt select-Ausdrücke mit halbem Bild Versatz', () => {
    expect(selectExpr([{ start: 0, end: 1 }], 50)).toBe('between(t,-0.01,0.99)')
  })
})

describe('Transkript', () => {
  it('liest whisper.cpp-JSON und hängt Satzzeichen an', () => {
    const json = {
      result: { language: 'de' },
      transcription: [
        { offsets: { from: 0, to: 0 }, text: '' },
        { offsets: { from: 0, to: 400 }, text: ' Hallo' },
        { offsets: { from: 400, to: 420 }, text: ',' },
        { offsets: { from: 500, to: 900 }, text: ' Leute' },
        { offsets: { from: 900, to: 1500 }, text: ' [Musik]' },
        { offsets: { from: 1500, to: 1500 }, text: ' heute' }
      ]
    }
    const r = parseWhisperCppJson(json)
    expect(r.language).toBe('de')
    expect(r.words.map((w) => w.text)).toEqual(['Hallo,', 'Leute', 'heute'])
    expect(r.words[0].end).toBeCloseTo(0.42)
    expect(r.words[2].end).toBeGreaterThan(r.words[2].start)
  })
})

describe('Untertitel', () => {
  const w = (text: string, start: number, end: number): Word => ({ text, start, end })
  const words = [
    w('Heute', 0, 0.3),
    w('zeige', 0.3, 0.6),
    w('ich', 0.6, 0.7),
    w('dir', 0.7, 0.9),
    w('drei', 0.9, 1.2),
    w('Übungen.', 1.2, 1.8),
    w('Los', 3, 3.3),
    w('geht’s!', 3.3, 3.8)
  ]

  it('bildet Blöcke mit 2–4 Wörtern und trennt an Satzende und Pausen', () => {
    const blocks = buildCaptionBlocks(words, { maxWords: 3 })
    const texts = blocks.map((b) => b.words.map((x) => x.text).join(' '))
    expect(texts).toEqual(['Heute zeige ich', 'dir drei Übungen.', 'Los geht’s!'])
    for (const b of blocks) expect(b.words.length).toBeLessThanOrEqual(3)
  })

  it('lässt Wörter weg, die komplett herausgeschnitten sind', () => {
    const seg = keepSegments(4, [{ id: 'c', start: 2.9, end: 3.35, enabled: true }])
    const blocks = buildCaptionBlocks(words, {}, seg)
    expect(blocks.flatMap((b) => b.words.map((x) => x.text))).not.toContain('Los')
  })

  it('markiert automatisch ein Schlüsselwort', () => {
    const b = autoKeyword({ id: 'b', words: [w('dir', 0, 1), w('drei', 1, 2), w('Übungen.', 2, 3)] })
    expect(b.words.find((x) => x.keyword)?.text).toBe('Übungen.')
  })

  it('übernimmt Korrekturen und behält das Timing', () => {
    const block = { id: 'b', words: [w('Hallo', 1, 1.5), w('Leude', 1.5, 2)] }
    const same = applyEditorText(block, 'Hallo *Leute*')
    expect(same.words).toEqual([
      { text: 'Hallo', start: 1, end: 1.5 },
      { text: 'Leute', start: 1.5, end: 2, keyword: true }
    ])
    expect(blockToEditorText(same)).toBe('Hallo *Leute*')
    const more = applyEditorText(block, 'Hallo liebe Leute')
    expect(more.words).toHaveLength(3)
    expect(more.words[0].start).toBe(1)
    expect(more.words[2].end).toBe(2)
  })
})

describe('ASS', () => {
  it('wandelt Farben und Zeiten um', () => {
    expect(assColor('#E01E26')).toBe('&H00261EE0')
    expect(assTime(3723.456)).toBe('1:02:03.46')
  })

  it('rechnet CSS-Pixel in libass-Schriftgröße um', () => {
    expect(assFontSize('Anton', 100)).toBe(173)
    expect(assFontSize('Unbekannt', 80)).toBe(100)
  })

  it('erzeugt Hook, Untertitel in Ausgabezeit und rote Schlüsselwörter', () => {
    const preset = DEFAULT_PRESETS.find((p) => p.id === 'rafael')!
    const segments = keepSegments(10, [{ id: 'c', start: 0, end: 2, enabled: true }])
    const ass = buildAss({
      width: 1080,
      height: 1920,
      preset,
      captions: [{ id: 'a', words: [{ text: 'Mehr', start: 2.5, end: 2.8 }, { text: 'Muskeln', start: 2.8, end: 3.4, keyword: true }] }],
      captionsEnabled: true,
      hook: { enabled: true, text: '3 Fehler beim Bankdrücken', durationSec: 2.5 },
      segments
    })
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toMatch(/Dialogue: 1,0:00:00.00,0:00:02.50,Hook,.*3 FEHLER BEIM BANKDRÜCKEN/)
    // 2,5 s Quelle → 0,5 s Ausgabe (die ersten 2 s sind geschnitten)
    expect(ass).toMatch(/Dialogue: 0,0:00:00.50,0:00:01.40,Caption,.*\\pos\(540,1152\).*MEHR \{\\c&H261EE0&\}MUSKELN/)
  })
})

describe('Render', () => {
  it('berechnet den 9:16-Ausschnitt aus Querformat', () => {
    expect(cropRect(1920, 1080, '9:16', 1, 0, 0)).toEqual({ w: 606, h: 1080, x: 657, y: 0 })
    const right = cropRect(1920, 1080, '9:16', 1, 1, 0)
    expect(right.x + right.w).toBe(1920)
  })

  it('liest loudnorm-Messwerte', () => {
    const stderr = `[Parsed_loudnorm_3 @ 0x1]\n{\n\t"input_i" : "-23.51",\n\t"input_tp" : "-4.20",\n\t"input_lra" : "5.10",\n\t"input_thresh" : "-33.90",\n\t"target_offset" : "0.30"\n}\n`
    expect(parseLoudnorm(stderr)).toEqual({ input_i: '-23.51', input_tp: '-4.20', input_lra: '5.10', input_thresh: '-33.90', target_offset: '0.30' })
  })
})

describe('Projekt', () => {
  it('speichert und lädt, fehlende Felder werden ergänzt', () => {
    const p = createProject('Test')
    const back = parseProject(serializeProject(p))
    expect(back).toEqual(p)
    const old = parseProject(JSON.stringify({ version: 1, name: 'Alt', format: { aspect: '4:5' } }))
    expect(old.format.mode).toBe('fill')
    expect(old.format.aspect).toBe('4:5')
  })
})
