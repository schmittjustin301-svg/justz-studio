import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { detectTools, type Tools } from '../src/node/tools'

export const TMP = resolve('tests/.tmp')
export const FONTS = resolve('resources/fonts')

export function tmpPath(name: string): string {
  mkdirSync(TMP, { recursive: true })
  return join(TMP, name)
}

export async function tools(): Promise<Tools> {
  return detectTools(FONTS)
}

/** Ton: Sprache (Sinus) von 0–1 s, 2–3,5 s, 4,3–5,3 s; dazwischen Stille. */
export const SPEECH = [
  [0, 1],
  [2, 3.5],
  [4.3, 5.3]
] as const
export const CLIP_DURATION = 5.3

/**
 * Erzeugt einen Testclip wie vom iPhone: Querformat-Pixel mit 90°-Rotation (Anzeige hochkant),
 * optional HEVC 10 bit HLG mit 60 fps.
 */
export function makeClip(name: string, opts: { hevcHdr?: boolean; fps?: number; audio?: boolean } = {}): string {
  const out = tmpPath(name)
  if (existsSync(out)) return out
  const fps = opts.fps ?? 60
  const raw = tmpPath('raw-' + name)
  const gate = SPEECH.map(([a, b]) => `between(t,${a},${b})`).join('+')
  const args = ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=${fps}:duration=${CLIP_DURATION}`]
  if (opts.audio !== false) args.push('-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*220*t)*(${gate})':s=48000:d=${CLIP_DURATION}`)
  if (opts.hevcHdr) {
    args.push('-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc', '-tag:v', 'hvc1')
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
  }
  if (opts.audio !== false) args.push('-c:a', 'aac')
  args.push('-y', raw)
  execFileSync('ffmpeg', args)
  execFileSync('ffmpeg', ['-v', 'error', '-display_rotation', '90', '-i', raw, '-c', 'copy', '-y', out])
  return out
}

export function probeJson(path: string): { streams: Array<Record<string, unknown>>; format: Record<string, string> } {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]).toString())
}

/** Integrierte Lautheit (LUFS) einer Datei, gemessen mit ebur128. */
export function measureLufs(path: string): number {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-filter_complex', 'ebur128=framelog=quiet', '-f', 'null', '-'])
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(res.stderr.toString())
  if (!m) throw new Error('ebur128 ohne Ergebnis')
  return Number(m[1])
}
