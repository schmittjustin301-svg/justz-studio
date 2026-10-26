import type { MediaInfo } from './types'

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  sample_rate?: string
  duration?: string
  color_transfer?: string
  tags?: Record<string, string>
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>
  disposition?: { attached_pic?: number }
}

export interface ProbeJson {
  streams?: ProbeStream[]
  format?: { duration?: string }
}

export const PROBE_ARGS = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams']

function parseRate(rate?: string): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!d) return n || 0
  return n / d
}

export function rotationOf(stream: ProbeStream): number {
  const side = stream.side_data_list?.find((s) => typeof s.rotation === 'number')
  const raw = side?.rotation ?? Number(stream.tags?.rotate ?? 0)
  return ((Math.round(raw) % 360) + 360) % 360
}

const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084'])

/** Wandelt die ffprobe-Ausgabe in die für uns relevanten Infos um. */
export function parseProbe(path: string, json: ProbeJson, stat: { size: number; mtimeMs: number }): MediaInfo {
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!video || !video.width || !video.height) throw new Error('Die Datei enthält keine Videospur.')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const rotation = rotationOf(video)
  const swap = rotation === 90 || rotation === 270
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30
  const duration = Number(json.format?.duration ?? video.duration ?? 0)
  if (!(duration > 0)) throw new Error('Die Videolänge konnte nicht bestimmt werden.')
  return {
    path,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    duration,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    fps: Math.round(fps * 1000) / 1000,
    rotation,
    videoCodec: video.codec_name ?? 'unbekannt',
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    hdr: HDR_TRANSFERS.has(video.color_transfer ?? ''),
    colorTransfer: video.color_transfer
  }
}

export function describeMedia(m: MediaInfo): string {
  const mins = Math.floor(m.duration / 60)
  const secs = Math.round(m.duration % 60).toString().padStart(2, '0')
  const parts = [`${m.width}×${m.height}`, `${Math.round(m.fps)} fps`, m.videoCodec.toUpperCase(), `${mins}:${secs}`]
  if (m.hdr) parts.push('HDR')
  if (!m.hasAudio) parts.push('ohne Ton')
  return parts.join(' · ')
}
