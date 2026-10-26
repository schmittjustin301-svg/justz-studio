import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

/**
 * `justz-media://local/?path=…` liefert lokale Dateien an die Oberfläche, mit HTTP-Range-Unterstützung,
 * damit man im Video springen kann. Nur Dateien, die vorher freigegeben wurden, werden ausgeliefert.
 */
export const MEDIA_SCHEME = 'justz-media'

const allowed = new Set<string>()

export function allowMedia(path: string): string {
  allowed.add(path)
  return `${MEDIA_SCHEME}://local/?path=${encodeURIComponent(path)}`
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const url = new URL(req.url)
    const path = url.searchParams.get('path') ?? ''
    if (!allowed.has(path)) return new Response('Nicht freigegeben', { status: 403 })
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return new Response('Nicht gefunden', { status: 404 })
    }
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
    if (!range) {
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream
      return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
    }
    let start = range[1] ? Number(range[1]) : 0
    let end = range[2] ? Number(range[2]) : size - 1
    if (!range[1] && range[2]) {
      start = Math.max(0, size - Number(range[2]))
      end = size - 1
    }
    end = Math.min(end, size - 1)
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}
