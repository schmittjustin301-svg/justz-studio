// Gemeinsame Datentypen der Schnitt-Engine. Alle Zeiten in Sekunden, bezogen auf das Quellvideo,
// solange nicht ausdrücklich "Ausgabezeit" dasteht.

export interface MediaInfo {
  path: string
  /** Dateigröße + Änderungszeit, um Cache-Einträge zuzuordnen. */
  size: number
  mtimeMs: number
  duration: number
  /** Breite/Höhe wie angezeigt (Rotation bereits berücksichtigt). */
  width: number
  height: number
  fps: number
  rotation: number
  videoCodec: string
  hasAudio: boolean
  audioCodec?: string
  sampleRate?: number
  /** HDR (HLG/PQ) vom iPhone → beim Export auf SDR tonemappen. */
  hdr: boolean
  colorTransfer?: string
}

export interface SilenceSettings {
  /** Alles unterhalb dieser Lautstärke (dBFS) gilt als Stille. */
  thresholdDb: number
  /** Kürzere Pausen bleiben drin. */
  minPauseSec: number
  /** Luft, die vor und nach dem Gesprochenen stehen bleibt. */
  paddingSec: number
}

export interface Cut {
  id: string
  start: number
  end: number
  enabled: boolean
}

export interface Word {
  text: string
  start: number
  end: number
  /** Wahrscheinlichkeit aus Whisper (0–1), falls vorhanden. */
  p?: number
}

export interface Transcript {
  language: string
  model: string
  words: Word[]
}

export interface CaptionWord extends Word {
  keyword?: boolean
}

export interface CaptionBlock {
  id: string
  words: CaptionWord[]
}

export type CaptionPosition = 'top' | 'center' | 'below-center' | 'bottom'

export interface CaptionPreset {
  id: string
  name: string
  fontFamily: string
  /** Schriftgröße in px bezogen auf 1080 px Ausgabebreite. */
  fontSize: number
  uppercase: boolean
  textColor: string
  keywordColor: string
  /** Farbe des gerade gesprochenen Worts; leer = aus. */
  activeWordColor: string
  outlineColor: string
  outlineWidth: number
  shadow: number
  /** Vertikale Position der Textmitte, 0 = oben, 1 = unten. */
  positionY: number
  /** Automatisch ein Schlüsselwort pro Block markieren. */
  autoKeyword: boolean
  animation: 'none' | 'pop'
  maxWordsPerBlock: number
  hook: HookStyle
}

export interface HookStyle {
  fontFamily: string
  fontSize: number
  textColor: string
  barColor: string
  positionY: number
  uppercase: boolean
}

export interface HookSettings {
  enabled: boolean
  text: string
  durationSec: number
}

export type AspectRatio = '9:16' | '4:5' | '16:9'

export interface FormatSettings {
  aspect: AspectRatio
  /** fill = zuschneiden, blur = einpassen mit unscharfem Hintergrund */
  mode: 'fill' | 'blur'
  /** 1 = so viel Bild wie möglich, >1 = reinzoomen */
  zoom: number
  /** -1 … 1, Verschiebung des Ausschnitts */
  offsetX: number
  offsetY: number
}

export interface MusicSettings {
  enabled: boolean
  path: string
  /** Grundlautstärke der Musik in dB (relativ). */
  volumeDb: number
  ducking: 'off' | 'light' | 'medium' | 'strong'
}

export interface ExportSettings {
  fps: 30 | 60
  quality: 'high' | 'max'
  speed: 'fast' | 'normal'
  targetLufs: number
}

export interface Project {
  version: 1
  name: string
  media: MediaInfo | null
  silence: SilenceSettings
  cuts: Cut[]
  transcript: Transcript | null
  captions: CaptionBlock[]
  captionsEnabled: boolean
  presetId: string
  hook: HookSettings
  format: FormatSettings
  music: MusicSettings
  export: ExportSettings
}
