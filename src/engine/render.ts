import type { Range } from './silence'
import { outputDuration } from './timeline'
import type { AspectRatio, ExportSettings, FormatSettings, MediaInfo, MusicSettings } from './types'

export const OUTPUT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 }
}

export const AUDIO_RATE = 48000

export interface CropRect {
  w: number
  h: number
  x: number
  y: number
}

const even = (v: number): number => Math.max(2, Math.floor(v / 2) * 2)

/** Ausschnitt im Quellbild für das Zielformat (Modus "zuschneiden"). */
export function cropRect(srcW: number, srcH: number, aspect: AspectRatio, zoom: number, offsetX: number, offsetY: number): CropRect {
  const { width, height } = OUTPUT_SIZES[aspect]
  const target = width / height
  const z = Math.max(1, zoom)
  let w: number
  let h: number
  if (srcW / srcH > target) {
    h = srcH / z
    w = h * target
  } else {
    w = srcW / z
    h = w / target
  }
  w = even(Math.min(w, srcW))
  h = even(Math.min(h, srcH))
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v))
  const x = Math.round(((srcW - w) / 2) * (1 + clamp(offsetX)))
  const y = Math.round(((srcH - h) / 2) * (1 + clamp(offsetY)))
  return { w, h, x: Math.min(srcW - w, Math.max(0, x)), y: Math.min(srcH - h, Math.max(0, y)) }
}

/** Ausdruck für select/aselect: wahr, wenn t in einem behaltenen Segment liegt. */
export function selectExpr(segments: Range[], fps: number): string {
  const half = 0.5 / fps
  const f = (v: number): string => (Math.round(v * 1e6) / 1e6).toString()
  return segments.map((s) => `between(t,${f(s.start - half)},${f(s.end - half)})`).join('+')
}

const DUCK_RATIO: Record<MusicSettings['ducking'], number> = { off: 1, light: 3, medium: 6, strong: 12 }

export interface LoudnormMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

export interface GraphInput {
  media: MediaInfo
  segments: Range[]
  format: FormatSettings
  music: MusicSettings | null
  exportSettings: ExportSettings
  /** Dateiname der ASS-Datei relativ zum Arbeitsordner, null = ohne Untertitel/Hook. */
  assFile: string | null
  fontsDir: string
  /** zscale/tonemap verfügbar → HDR-Material wird korrekt in SDR umgewandelt. */
  canTonemap: boolean
  loudnorm: LoudnormMeasurement | null
  /** Nur Ton aufbauen (für die Lautheitsmessung). */
  audioOnly?: boolean
}

const TRUE_PEAK = -1
const LRA = 11

export function loudnormFilter(target: number, m: LoudnormMeasurement | null): string {
  const base = `loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=${LRA}`
  if (!m) return `${base}:print_format=json`
  return `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`
}

/** Video-Kette nach dem Schnitt: Tonemapping, Format, Untertitel. */
export function videoChain(g: Pick<GraphInput, 'media' | 'format' | 'assFile' | 'fontsDir' | 'canTonemap'>, label: string, out: string): string {
  const { width: W, height: H } = OUTPUT_SIZES[g.format.aspect]
  const parts: string[] = []
  const tonemap =
    g.media.hdr && g.canTonemap
      ? ',zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv'
      : ''
  if (g.format.mode === 'blur') {
    const fg = `${Math.round(W * Math.max(1, g.format.zoom))}`
    parts.push(
      `${label}null${tonemap},split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=12:2,scale=${W}:${H},eq=brightness=-0.06[bg]`,
      `[fgsrc]scale=${fg}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2${subs(g)},format=yuv420p${out}`
    )
  } else {
    const c = cropRect(g.media.width, g.media.height, g.format.aspect, g.format.zoom, g.format.offsetX, g.format.offsetY)
    parts.push(`${label}crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H}:flags=lanczos,setsar=1${tonemap}${subs(g)},format=yuv420p${out}`)
  }
  return parts.join(';')
}

function subs(g: Pick<GraphInput, 'assFile' | 'fontsDir'>): string {
  return g.assFile ? `,subtitles=filename=${g.assFile}:fontsdir=${g.fontsDir}` : ''
}

/** Kompletter Filtergraph für den Export (oder nur Ton für die Lautheitsmessung). */
export function buildFilterGraph(g: GraphInput): string {
  const fps = g.exportSettings.fps
  const expr = selectExpr(g.segments, fps)
  const dur = outputDuration(g.segments)
  const chains: string[] = []

  if (!g.audioOnly) {
    chains.push(`[0:v]fps=${fps},select='${expr}',setpts=N/(${fps}*TB)[vcut]`)
    chains.push(videoChain(g, '[vcut]', '[vout]'))
  }

  if (g.media.hasAudio) {
    const n = AUDIO_RATE / fps
    chains.push(
      `[0:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,asetnsamples=n=${n}:p=0,aselect='${expr}',asetpts=N/SR/TB[voice]`
    )
  } else {
    chains.push(`anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${dur.toFixed(3)}[voice]`)
  }

  let mixLabel = '[voice]'
  if (g.music?.enabled && g.music.path) {
    const fadeStart = Math.max(0, dur - 1.5).toFixed(3)
    chains.push(
      `[1:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${g.music.volumeDb}dB,atrim=duration=${dur.toFixed(3)},afade=t=in:d=0.3,afade=t=out:st=${fadeStart}:d=1.5[mus]`
    )
    if (g.music.ducking !== 'off' && g.media.hasAudio) {
      chains.push(`[voice]asplit=2[vmix][vsc]`)
      chains.push(`[mus][vsc]sidechaincompress=threshold=0.03:ratio=${DUCK_RATIO[g.music.ducking]}:attack=15:release=350[mduck]`)
      chains.push(`[vmix][mduck]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[mix]`)
    } else {
      chains.push(`[voice][mus]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[mix]`)
    }
    mixLabel = '[mix]'
  }
  chains.push(`${mixLabel}${loudnormFilter(g.exportSettings.targetLufs, g.loudnorm)},aresample=${AUDIO_RATE}[aout]`)
  return chains.join(';\n')
}

/**
 * Einzelbild-Vorschau mit allen Effekten: Die Quelle wird per -ss an `sourceTime` gesprungen und die
 * Zeitstempel auf die Ausgabezeit gesetzt, damit Untertitel/Hook genau so erscheinen wie im Export.
 */
export function previewFrameArgs(
  g: Pick<GraphInput, 'media' | 'format' | 'assFile' | 'fontsDir' | 'canTonemap'>,
  sourceTime: number,
  outputTime: number,
  outPath: string
): string[] {
  const graph = `[0:v]setpts=PTS-STARTPTS+${outputTime.toFixed(3)}/TB[vin];${videoChain(g, '[vin]', '[vout]')}`
  return ['-ss', sourceTime.toFixed(3), '-i', g.media.path, '-filter_complex', graph, '-map', '[vout]', '-frames:v', '1', '-q:v', '3', '-y', outPath]
}

export function inputArgs(media: MediaInfo, music: MusicSettings | null): string[] {
  const args = ['-i', media.path]
  if (music?.enabled && music.path) args.push('-stream_loop', '-1', '-i', music.path)
  return args
}

export function encodeArgs(s: ExportSettings, outPath: string): string[] {
  return [
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', s.speed === 'fast' ? 'veryfast' : 'medium',
    '-crf', s.quality === 'max' ? '16' : '19',
    '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p',
    '-r', String(s.fps), '-g', String(s.fps * 2),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(AUDIO_RATE),
    '-movflags', '+faststart',
    '-metadata', 'comment=Erstellt mit JUSTZ Studio',
    '-progress', 'pipe:1', '-nostats',
    '-y', outPath
  ]
}

/** Liest die JSON-Messwerte von loudnorm aus der FFmpeg-Konsolenausgabe. */
export function parseLoudnorm(stderr: string): LoudnormMeasurement {
  const idx = stderr.lastIndexOf('[Parsed_loudnorm')
  const from = stderr.indexOf('{', idx < 0 ? 0 : idx)
  const to = stderr.indexOf('}', from)
  if (from < 0 || to < 0) throw new Error('Lautheitsmessung fehlgeschlagen (keine loudnorm-Ausgabe).')
  const j = JSON.parse(stderr.slice(from, to + 1)) as Record<string, string>
  const pick = (k: string): string => {
    const v = j[k]
    if (v === undefined || v === '-inf' || v === 'inf' || Number.isNaN(Number(v))) return k === 'input_tp' ? '-99' : '-70'
    return v
  }
  return {
    input_i: pick('input_i'),
    input_tp: pick('input_tp'),
    input_lra: j.input_lra && !Number.isNaN(Number(j.input_lra)) ? j.input_lra : '0',
    input_thresh: pick('input_thresh'),
    target_offset: j.target_offset && !Number.isNaN(Number(j.target_offset)) ? j.target_offset : '0'
  }
}

/** Fortschritt aus `-progress pipe:1` (Sekunden der Ausgabe). */
export function parseProgressChunk(chunk: string): number | null {
  const m = /out_time_us=(\d+)/g
  let last: number | null = null
  let r: RegExpExecArray | null
  while ((r = m.exec(chunk))) last = Number(r[1]) / 1e6
  return last
}
