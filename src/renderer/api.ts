import type { JustzApi } from '../shared/api'

declare global {
  interface Window {
    justz: JustzApi
  }
}

export const api = (): JustzApi => window.justz

export function newJobId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Electron hängt "Error invoking remote method '…': Error: " davor
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function formatTime(t: number, withMs = false): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return withMs ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${m}:${Math.floor(sec).toString().padStart(2, '0')}`
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
}

export function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]+$/, '') + '/' + name
}
