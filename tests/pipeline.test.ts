import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { autoKeyword, buildCaptionBlocks, buildCuts, createProject, DEFAULT_PRESETS, keepSegments, outputDuration, type Project, type Word } from '../src/engine'
import { analyzeMedia, probeMedia } from '../src/node/analysis'
import { exportProject, renderPreviewFrame } from '../src/node/exporter'
import type { Tools } from '../src/node/tools'
import { CLIP_DURATION, makeClip, measureLufs, probeJson, SPEECH, tmpPath, tools as detect } from './helpers'

let tools: Tools

beforeAll(async () => {
  tools = await detect()
  if (!tools.ffmpeg) throw new Error('Für die Pipeline-Tests muss FFmpeg installiert sein.')
})

async function prepared(name: string, opts: Parameters<typeof makeClip>[1] = {}): Promise<Project> {
  const clip = makeClip(name, opts)
  const project = createProject('Test')
  project.media = await probeMedia(tools, clip)
  const analysis = await analyzeMedia(tools, project.media, tmpPath('cache'))
  project.cuts = project.media.hasAudio ? buildCuts(analysis.envelope, project.media.duration, project.silence) : []
  return project
}

describe('Pipeline mit echtem FFmpeg', () => {
  it('importiert ein iPhone-artiges Video (Rotation, HEVC 10 bit HLG, 60 fps)', async () => {
    const p = await prepared('iphone.mov', { hevcHdr: true })
    expect(p.media).toMatchObject({ width: 360, height: 640, fps: 60, videoCodec: 'hevc', hdr: true, hasAudio: true })
  })

  it('findet die Pausen im Testclip', async () => {
    const p = await prepared('h264.mp4')
    const enabled = p.cuts.filter((c) => c.enabled)
    expect(enabled).toHaveLength(2)
    // Pause 1: 1,0–2,0 s, Pause 2: 3,5–4,3 s, jeweils mit Luft
    expect(enabled[0].start).toBeCloseTo(SPEECH[0][1] + p.silence.paddingSec, 1)
    expect(enabled[0].end).toBeCloseTo(SPEECH[1][0] - p.silence.paddingSec, 1)
    expect(enabled[1].start).toBeCloseTo(SPEECH[1][1] + p.silence.paddingSec, 1)
  })

  it('exportiert 9:16 mit Schnitten, Untertiteln, Hook, Musik-Ducking und -14 LUFS', async () => {
    const p = await prepared('iphone.mov', { hevcHdr: true })
    const words: Word[] = [
      { text: 'Drei', start: 0.1, end: 0.4 },
      { text: 'Fehler', start: 0.4, end: 0.9 },
      { text: 'beim', start: 2.1, end: 2.4 },
      { text: 'Bankdrücken!', start: 2.4, end: 3.3 }
    ]
    p.transcript = { language: 'de', model: 'test', words }
    p.captions = buildCaptionBlocks(words).map(autoKeyword)
    p.presetId = 'rafael'
    p.hook = { enabled: true, text: 'Das macht jeder falsch', durationSec: 2 }
    p.music = { enabled: true, path: makeMusic(), volumeDb: -12, ducking: 'medium' }
    const out = tmpPath('export-9x16.mp4')
    const stages = new Set<string>()
    const res = await exportProject(tools, p, DEFAULT_PRESETS.find((x) => x.id === 'rafael')!, out, (s) => stages.add(s.stage))

    expect(existsSync(out)).toBe(true)
    expect([...stages]).toEqual(expect.arrayContaining(['loudness', 'encode', 'done']))
    const info = probeJson(out)
    const v = info.streams.find((s) => s.codec_type === 'video')!
    const a = info.streams.find((s) => s.codec_type === 'audio')!
    expect(v).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', avg_frame_rate: '30/1' })
    expect(a).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 })
    const expected = outputDuration(keepSegments(p.media!.duration, p.cuts, 30))
    expect(expected).toBeLessThan(CLIP_DURATION - 1)
    expect(Number(info.format.duration)).toBeCloseTo(expected, 1)
    expect(Number(v.duration)).toBeCloseTo(Number(a.duration), 1)
    expect(res.duration).toBeCloseTo(expected, 3)
    expect(measureLufs(out)).toBeGreaterThan(-15.5)
    expect(measureLufs(out)).toBeLessThan(-12.5)
  })

  it('exportiert 16:9 im Blur-Modus ohne Musik und ohne Ton in der Quelle', async () => {
    const p = await prepared('stumm.mp4', { audio: false, fps: 30 })
    p.format = { aspect: '16:9', mode: 'blur', zoom: 1, offsetX: 0, offsetY: 0 }
    const out = tmpPath('export-16x9.mp4')
    await exportProject(tools, p, DEFAULT_PRESETS[0], out)
    const v = probeJson(out).streams.find((s) => s.codec_type === 'video')!
    expect(v).toMatchObject({ width: 1920, height: 1080 })
  })

  it('rendert ein Vorschaubild mit Untertiteln', async () => {
    const p = await prepared('h264.mp4')
    p.captions = [{ id: 'x', words: [{ text: 'Vorschau', start: 2.2, end: 3, keyword: true }] }]
    const out = await renderPreviewFrame(tools, p, DEFAULT_PRESETS[0], 2.5, tmpPath('frame.jpg'))
    expect(existsSync(out)).toBe(true)
  })
})

function makeMusic(): string {
  const path = tmpPath('musik.m4a')
  if (!existsSync(path)) {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=2', '-c:a', 'aac', '-y', path])
  }
  return path
}
