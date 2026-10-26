import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ANALYSIS_SAMPLE_RATE, computeEnvelope, type Envelope } from '../engine/silence'
import { PROBE_ARGS, parseProbe, type ProbeJson } from '../engine/media'
import type { MediaInfo } from '../engine/types'
import { run } from './proc'
import { canTonemap, requireFfmpeg, type Tools } from './tools'

export async function probeMedia(tools: Tools, path: string): Promise<MediaInfo> {
  const { ffprobe } = requireFfmpeg(tools)
  const st = await stat(path)
  const res = await run(ffprobe, [...PROBE_ARGS, path])
  return parseProbe(path, JSON.parse(res.stdout) as ProbeJson, { size: st.size, mtimeMs: st.mtimeMs })
}

/** Cache-Ordner pro Quelldatei (Pfad + Größe + Änderungszeit). */
export function cacheDirFor(cacheRoot: string, media: Pick<MediaInfo, 'path' | 'size' | 'mtimeMs'>): string {
  const h = createHash('sha1').update(`${media.path}|${media.size}|${Math.round(media.mtimeMs)}`).digest('hex').slice(0, 16)
  return join(cacheRoot, h)
}

export interface AnalysisResult {
  proxyPath: string
  wavPath: string
  envelope: Envelope
}

export type ProgressFn = (stage: string, fraction: number) => void

/** Erstellt (oder lädt aus dem Cache) Vorschau-Proxy, 16-kHz-WAV und Lautstärkeverlauf. */
export async function analyzeMedia(tools: Tools, media: MediaInfo, cacheRoot: string, onProgress?: ProgressFn, signal?: AbortSignal): Promise<AnalysisResult> {
  const { ffmpeg } = requireFfmpeg(tools)
  const dir = cacheDirFor(cacheRoot, media)
  await mkdir(dir, { recursive: true })
  const wavPath = join(dir, 'audio16k.wav')
  const proxyPath = join(dir, 'proxy.mp4')
  const envPath = join(dir, 'envelope.f32')

  if (!existsSync(wavPath)) {
    onProgress?.('Ton wird analysiert', 0)
    const tmp = wavPath + '.part.wav'
    if (media.hasAudio) {
      await run(ffmpeg, ['-hide_banner', '-v', 'error', '-i', media.path, '-vn', '-ac', '1', '-ar', String(ANALYSIS_SAMPLE_RATE), '-c:a', 'pcm_s16le', '-y', tmp], { signal })
    } else {
      await run(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${ANALYSIS_SAMPLE_RATE}:cl=mono`, '-t', media.duration.toFixed(3), '-c:a', 'pcm_s16le', '-y', tmp], { signal })
    }
    await rename(tmp, wavPath)
  }

  let envelope: Envelope
  if (existsSync(envPath)) {
    const buf = await readFile(envPath)
    envelope = { windowSec: buf.readFloatLE(0), db: new Float32Array(buf.buffer.slice(buf.byteOffset + 4, buf.byteOffset + buf.length)) }
  } else {
    const samples = readWavPcm16(await readFile(wavPath))
    envelope = computeEnvelope(samples, ANALYSIS_SAMPLE_RATE)
    const head = Buffer.alloc(4)
    head.writeFloatLE(envelope.windowSec, 0)
    await writeFile(envPath, Buffer.concat([head, Buffer.from(envelope.db.buffer, envelope.db.byteOffset, envelope.db.byteLength)]))
  }

  if (!existsSync(proxyPath)) {
    onProgress?.('Vorschau wird erstellt', 0)
    const tmp = proxyPath + '.part.mp4'
    const tonemap = media.hdr && canTonemap(tools) ? ',zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv' : ''
    // Kleine H.264-Datei mit vielen Keyframes: spielt überall flüssig und springt schnell.
    const vf = `fps=${Math.min(30, Math.round(media.fps) || 30)},scale='if(gt(iw,ih),960,-2)':'if(gt(iw,ih),-2,960)'${tonemap},format=yuv420p`
    await run(
      ffmpeg,
      ['-hide_banner', '-v', 'error', '-i', media.path, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-g', '10', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-y', tmp],
      {
        signal,
        onStdout: (s) => {
          const m = /out_time_us=(\d+)/.exec(s)
          if (m) onProgress?.('Vorschau wird erstellt', Math.min(1, Number(m[1]) / 1e6 / media.duration))
        }
      }
    )
    await rename(tmp, proxyPath)
  }
  onProgress?.('Fertig', 1)
  return { proxyPath, wavPath, envelope }
}

/** Liest die Samples aus einer 16-bit-PCM-WAV-Datei (Chunks werden korrekt übersprungen). */
export function readWavPcm16(buf: Buffer): Int16Array {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Keine WAV-Datei')
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    let size = buf.readUInt32LE(pos + 4)
    if (id === 'data') {
      if (size === 0 || size === 0xffffffff || pos + 8 + size > buf.length) size = buf.length - pos - 8
      const start = pos + 8
      const copy = Buffer.from(buf.subarray(start, start + size - (size % 2)))
      return new Int16Array(copy.buffer, copy.byteOffset, copy.length / 2)
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV-Datei ohne Daten')
}
