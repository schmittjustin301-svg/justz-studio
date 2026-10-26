import type { Project } from './types'

export const PROJECT_EXTENSION = 'justz'

export const DEFAULT_SILENCE = { thresholdDb: -38, minPauseSec: 0.45, paddingSec: 0.12 }

export function createProject(name = 'Neues Projekt'): Project {
  return {
    version: 1,
    name,
    media: null,
    silence: { ...DEFAULT_SILENCE },
    cuts: [],
    transcript: null,
    captions: [],
    captionsEnabled: true,
    presetId: 'justz-standard',
    hook: { enabled: false, text: '', durationSec: 2.5 },
    format: { aspect: '9:16', mode: 'fill', zoom: 1, offsetX: 0, offsetY: 0 },
    music: { enabled: false, path: '', volumeDb: -16, ducking: 'medium' },
    export: { fps: 30, quality: 'high', speed: 'normal', targetLufs: -14 }
  }
}

/** Liest eine Projektdatei ein und füllt fehlende Felder mit Standardwerten auf. */
export function parseProject(json: string): Project {
  const raw = JSON.parse(json) as Partial<Project>
  if (raw.version !== 1) throw new Error('Unbekannte Projektversion – Datei stammt nicht aus JUSTZ Studio.')
  const base = createProject(raw.name)
  return {
    ...base,
    ...raw,
    silence: { ...base.silence, ...raw.silence },
    hook: { ...base.hook, ...raw.hook },
    format: { ...base.format, ...raw.format },
    music: { ...base.music, ...raw.music },
    export: { ...base.export, ...raw.export },
    cuts: raw.cuts ?? [],
    captions: raw.captions ?? [],
    transcript: raw.transcript ?? null,
    media: raw.media ?? null
  }
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

let idCounter = 0
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
