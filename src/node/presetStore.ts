import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_PRESETS, normalizePreset } from '../engine/presets'
import type { CaptionPreset } from '../engine/types'

/** Kunden-Presets liegen als JSON im App-Datenordner. Eingebaute Presets können überschrieben werden. */
export class PresetStore {
  constructor(private readonly file: string) {}

  async list(): Promise<CaptionPreset[]> {
    const own = await this.readOwn()
    const merged = DEFAULT_PRESETS.map((d) => own.find((o) => o.id === d.id) ?? d)
    return [...merged, ...own.filter((o) => !DEFAULT_PRESETS.some((d) => d.id === o.id))]
  }

  async save(p: CaptionPreset): Promise<CaptionPreset[]> {
    const own = (await this.readOwn()).filter((o) => o.id !== p.id)
    own.push(normalizePreset(p))
    await writeFile(this.file, JSON.stringify(own, null, 2), 'utf8')
    return this.list()
  }

  /** Löscht ein eigenes Preset bzw. setzt ein eingebautes auf Werkseinstellung zurück. */
  async remove(id: string): Promise<CaptionPreset[]> {
    const own = (await this.readOwn()).filter((o) => o.id !== id)
    await writeFile(this.file, JSON.stringify(own, null, 2), 'utf8')
    return this.list()
  }

  private async readOwn(): Promise<CaptionPreset[]> {
    if (!existsSync(this.file)) return []
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as CaptionPreset[]
      return Array.isArray(raw) ? raw.map(normalizePreset) : []
    } catch {
      return []
    }
  }
}
