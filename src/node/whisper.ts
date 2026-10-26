import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseWhisperCppJson, type WhisperCppJson } from '../engine/transcript'
import type { Transcript } from '../engine/types'
import { CancelledError, run } from './proc'

export interface WhisperModel {
  id: string
  label: string
  sizeMb: number
  note: string
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'base', label: 'Base', sizeMb: 142, note: 'Sehr schnell, für Tests' },
  { id: 'small', label: 'Small', sizeMb: 466, note: 'Standard – gut auf jedem Mac' },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo (komprimiert)', sizeMb: 547, note: 'Beste Qualität, empfohlen für Apple Silicon' },
  { id: 'medium', label: 'Medium', sizeMb: 1530, note: 'Genauer als Small, langsamer' }
]

export const DEFAULT_MODEL = 'small'

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export function modelPath(modelsDir: string, id: string): string {
  return join(modelsDir, `ggml-${id}.bin`)
}

export function isModelInstalled(modelsDir: string, id: string): boolean {
  return existsSync(modelPath(modelsDir, id))
}

/** Lädt ein Modell herunter (einmalig, ~0,1–1,5 GB) mit Fortschritt. */
export async function downloadModel(modelsDir: string, id: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  if (!WHISPER_MODELS.some((m) => m.id === id)) throw new Error(`Unbekanntes Modell: ${id}`)
  await mkdir(modelsDir, { recursive: true })
  const target = modelPath(modelsDir, id)
  if (existsSync(target)) return target
  const tmp = target + '.part'
  const res = await fetch(`${MODEL_BASE_URL}/ggml-${id}.bin`, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}). Internetverbindung prüfen.`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let done = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
  body.on('data', (chunk: Buffer) => {
    done += chunk.length
    if (total) onProgress?.(done / total)
  })
  try {
    await pipeline(body, createWriteStream(tmp))
  } catch (e) {
    await rm(tmp, { force: true })
    if (signal?.aborted) throw new CancelledError()
    throw e
  }
  const st = await stat(tmp)
  if (st.size < 10_000_000) {
    await rm(tmp, { force: true })
    throw new Error('Heruntergeladene Modelldatei ist unvollständig.')
  }
  await rename(tmp, target)
  return target
}

export interface TranscribeOptions {
  whisper: string
  modelsDir: string
  model: string
  /** 'de', 'en' oder 'auto' */
  language: string
  wavPath: string
  workDir: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export function whisperArgs(o: Pick<TranscribeOptions, 'modelsDir' | 'model' | 'language' | 'wavPath'>, outBase: string, threads: number): string[] {
  return [
    '-m', modelPath(o.modelsDir, o.model),
    '-f', o.wavPath,
    '-l', o.language,
    '-t', String(threads),
    // ein Eintrag pro Wort → Wort-Zeitstempel
    '-ml', '1', '-sow',
    '-oj', '-of', outBase,
    '-pp'
  ]
}

export async function transcribe(o: TranscribeOptions): Promise<Transcript> {
  if (!isModelInstalled(o.modelsDir, o.model)) throw new Error(`Modell "${o.model}" ist noch nicht heruntergeladen.`)
  await mkdir(o.workDir, { recursive: true })
  const outBase = join(o.workDir, `transcript-${o.model}-${o.language}`)
  const threads = Math.max(2, Math.min(8, cpus().length - 1))
  await run(o.whisper, whisperArgs(o, outBase, threads), {
    signal: o.signal,
    onStderr: (s) => {
      const m = /progress\s*=\s*(\d+)%/g
      let r: RegExpExecArray | null
      let last: number | null = null
      while ((r = m.exec(s))) last = Number(r[1])
      if (last !== null) o.onProgress?.(last / 100)
    }
  })
  const json = JSON.parse(await readFile(outBase + '.json', 'utf8')) as WhisperCppJson
  const parsed = parseWhisperCppJson(json)
  return { language: parsed.language, model: o.model, words: parsed.words }
}
