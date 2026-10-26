import { useMemo, useState } from 'react'
import {
  autoKeyword,
  blockEnd,
  blockStart,
  blockToEditorText,
  applyEditorText,
  buildCaptionBlocks,
  buildCuts,
  BUNDLED_FONTS,
  cutAt,
  DEFAULT_PRESETS,
  keepSegments,
  mapRange,
  mergeWithNext,
  outputDuration,
  splitBlock,
  toggleKeyword,
  type CaptionBlock,
  type CaptionPreset,
  type Envelope,
  type Project
} from '../../engine'
import type { EnvironmentInfo } from '../../shared/api'
import { baseName, formatTime } from '../api'
import { ColorField, Field, Icon, Segmented, Slider, Toggle, ToggleRow, Label } from './ui'

export type Update = (fn: (p: Project) => Project, coalesceKey?: string) => void

interface Props {
  project: Project
  update: Update
  envelope: Envelope
  env: EnvironmentInfo
  preset: CaptionPreset
  presets: CaptionPreset[]
  presetDirty: boolean
  onPresetChange: (p: CaptionPreset) => void
  onPresetSave: (asNewName?: string) => void
  onPresetDelete: () => void
  time: number
  seek: (t: number) => void
  onTranscribe: (language: string, model: string) => void
  onChooseMusic: () => void
}

type Tab = 'cut' | 'captions' | 'style' | 'format'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'cut', label: 'SCHNITT' },
  { id: 'captions', label: 'UNTERTITEL' },
  { id: 'style', label: 'STIL & HOOK' },
  { id: 'format', label: 'FORMAT & TON' }
]

export function Inspector(props: Props) {
  const [tab, setTab] = useState<Tab>('cut')
  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="inspector-body" key={tab}>
        {tab === 'cut' && <CutPanel {...props} />}
        {tab === 'captions' && <CaptionPanel {...props} />}
        {tab === 'style' && <StylePanel {...props} />}
        {tab === 'format' && <FormatPanel {...props} />}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ Schnitt */

function CutPanel({ project, update, envelope, seek }: Props) {
  const media = project.media!
  const segments = useMemo(() => keepSegments(media.duration, project.cuts), [media.duration, project.cuts])
  const out = outputDuration(segments)
  const active = project.cuts.filter((c) => c.enabled).length

  const setSilence = (patch: Partial<Project['silence']>): void =>
    update((p) => {
      const silence = { ...p.silence, ...patch }
      return { ...p, silence, cuts: buildCuts(envelope, media.duration, silence, p.cuts) }
    }, 'silence')

  if (!media.hasAudio) return <div className="notice">Das Video hat keine Tonspur – der Pausenschnitt ist nicht möglich.</div>

  return (
    <>
      <h3>Auto-Pausenschnitt</h3>
      <div className="stats">
        <div className="stat">
          <Label>Vorher</Label>
          <div className="num">{formatTime(media.duration, true)}</div>
        </div>
        <div className="stat">
          <Label>Nachher</Label>
          <div className="num red">{formatTime(out, true)}</div>
        </div>
        <div className="stat">
          <Label>Schnitte</Label>
          <div className="num">{active}</div>
        </div>
      </div>
      <div className="section">
        <Slider
          label="Schwelle Stille"
          value={project.silence.thresholdDb}
          min={-65}
          max={-15}
          step={1}
          format={(v) => `${v} dB`}
          hint="Höher = mehr wird als Pause erkannt. Bei Hintergrundgeräuschen erhöhen."
          onChange={(v) => setSilence({ thresholdDb: v })}
        />
        <Slider
          label="Mindestpause"
          value={project.silence.minPauseSec}
          min={0.15}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          hint="Kürzere Pausen bleiben drin."
          onChange={(v) => setSilence({ minPauseSec: v })}
        />
        <Slider
          label="Luft am Schnitt"
          value={project.silence.paddingSec}
          min={0}
          max={0.4}
          step={0.01}
          format={(v) => `${Math.round(v * 1000)} ms`}
          hint="So viel Pause bleibt vor und nach dem Gesprochenen stehen."
          onChange={(v) => setSilence({ paddingSec: v })}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn small" onClick={() => update((p) => ({ ...p, cuts: p.cuts.map((c) => ({ ...c, enabled: true })) }))}>
            Alle an
          </button>
          <button className="btn small" onClick={() => update((p) => ({ ...p, cuts: p.cuts.map((c) => ({ ...c, enabled: false })) }))}>
            Alle aus
          </button>
          <button className="btn small" onClick={() => update((p) => ({ ...p, cuts: buildCuts(envelope, media.duration, p.silence) }))} title="Manuelle Änderungen verwerfen">
            Neu erkennen
          </button>
        </div>
      </div>
      <Label>Schnitte</Label>
      <div className="blocks" style={{ marginTop: 8 }}>
        {project.cuts.length === 0 && <span className="hint">Keine Pausen gefunden.</span>}
        {project.cuts.map((c) => (
          <div key={c.id} className="block" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center', opacity: c.enabled ? 1 : 0.55 }}>
            <span className="t" style={{ paddingTop: 0 }} onClick={() => seek(Math.max(0, c.start - 0.6))}>
              {formatTime(c.start, true)} – {formatTime(c.end, true)} <span style={{ color: 'var(--text)' }}>({(c.end - c.start).toFixed(2)} s)</span>
            </span>
            <Toggle on={c.enabled} title="Schnitt an/aus" onChange={(on) => update((p) => ({ ...p, cuts: p.cuts.map((x) => (x.id === c.id ? { ...x, enabled: on } : x)) }))} />
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Untertitel */

function CaptionPanel({ project, update, env, preset, time, seek, onTranscribe }: Props) {
  const [language, setLanguage] = useState<string>(project.transcript?.language === 'en' ? 'en' : env.settings.language)
  const [model, setModel] = useState(env.settings.whisperModel)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const segments = useMemo(() => keepSegments(project.media!.duration, project.cuts), [project.media, project.cuts])
  const whisperMissing = !env.tools.whisper
  const modelInfo = env.models.find((m) => m.id === model)

  const setBlocks = (fn: (b: CaptionBlock[]) => CaptionBlock[]): void => update((p) => ({ ...p, captions: fn(p.captions) }))
  const regenerate = (): void => {
    if (!project.transcript) return
    if (!confirm('Untertitel neu aus dem Transkript erzeugen? Manuelle Korrekturen gehen dabei verloren.')) return
    update((p) => {
      let blocks = buildCaptionBlocks(p.transcript!.words, { maxWords: preset.maxWordsPerBlock }, segments)
      if (preset.autoKeyword) blocks = blocks.map(autoKeyword)
      return { ...p, captions: blocks }
    })
  }

  const transcribeBox = (
    <div className="section">
      {whisperMissing && (
        <div className="notice warning">
          whisper.cpp ist nicht installiert. Im Terminal: <code>brew install whisper-cpp</code> – danach die App neu starten.
        </div>
      )}
      <Field label="Sprache">
        <Segmented
          value={language}
          options={[
            { value: 'de', label: 'Deutsch' },
            { value: 'en', label: 'Englisch' },
            { value: 'auto', label: 'Automatisch' }
          ]}
          onChange={setLanguage}
        />
      </Field>
      <Field label="Modell" hint={modelInfo ? `${modelInfo.note} · ${modelInfo.installed ? 'installiert' : `wird geladen (${modelInfo.sizeMb} MB)`}` : undefined}>
        <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
          {env.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} {m.installed ? '✓' : `(${m.sizeMb} MB)`}
            </option>
          ))}
        </select>
      </Field>
      <button className="btn primary block big" disabled={whisperMissing} onClick={() => onTranscribe(language, model)}>
        <Icon name="wand" /> {project.transcript ? 'Neu transkribieren' : 'Transkribieren'}
      </button>
    </div>
  )

  if (!project.transcript)
    return (
      <>
        <h3>Untertitel</h3>
        <p className="hint" style={{ marginTop: -6, marginBottom: 16 }}>
          Die Sprache wird lokal auf dem Mac in Text umgewandelt (whisper.cpp) – nichts geht ins Internet. Danach entstehen automatisch Untertitel-Blöcke mit 2–4 Wörtern.
        </p>
        {transcribeBox}
      </>
    )

  return (
    <>
      <h3>Untertitel</h3>
      <div className="section">
        <ToggleRow label="Untertitel einbrennen" on={project.captionsEnabled} onChange={(v) => update((p) => ({ ...p, captionsEnabled: v }))} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={regenerate}>
            Blöcke neu erzeugen
          </button>
          <button className="btn small" onClick={() => setBlocks((bs) => bs.map(autoKeyword))}>
            Schlüsselwörter auto
          </button>
          <button className="btn small" onClick={() => setBlocks((bs) => bs.map((b) => ({ ...b, words: b.words.map(({ keyword: _k, ...w }) => w) })))}>
            Keine Schlüsselwörter
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Wort anklicken = Schlüsselwort an/aus. ✎ = Text korrigieren (Schlüsselwörter in *Sternchen*). Timing bleibt erhalten.
        </p>
      </div>
      <div className="blocks" style={{ ['--case' as string]: preset.uppercase ? 'uppercase' : 'none' }}>
        {project.captions.map((b) => {
          const current = time >= blockStart(b) && time < blockEnd(b)
          const isCut = mapRange(segments, { start: blockStart(b), end: blockEnd(b) }) === null || !!cutAt(project.cuts, (blockStart(b) + blockEnd(b)) / 2)
          return (
            <div key={b.id} className={`block ${current ? 'current' : ''} ${isCut ? 'cut' : ''}`}>
              <span className="t" onClick={() => seek(blockStart(b))} title="Hierhin springen">
                {formatTime(blockStart(b), true)}
              </span>
              {editing === b.id ? (
                <textarea
                  className="input"
                  autoFocus
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      setBlocks((bs) => bs.map((x) => (x.id === b.id ? applyEditorText(x, draft) : x)).filter((x) => x.words.length > 0))
                      setEditing(null)
                    }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={() => {
                    setBlocks((bs) => bs.map((x) => (x.id === b.id ? applyEditorText(x, draft) : x)).filter((x) => x.words.length > 0))
                    setEditing(null)
                  }}
                />
              ) : (
                <div className="words" onDoubleClick={() => (setEditing(b.id), setDraft(blockToEditorText(b)))}>
                  {b.words.map((w, i) => (
                    <span key={i} className={`word ${w.keyword ? 'kw' : ''}`} onClick={() => setBlocks((bs) => bs.map((x) => (x.id === b.id ? toggleKeyword(x, i) : x)))}>
                      {w.text}
                    </span>
                  ))}
                </div>
              )}
              <div className="actions">
                <button className="icon-btn" title="Text korrigieren" onClick={() => (setEditing(b.id), setDraft(blockToEditorText(b)))}>
                  <Icon name="edit" size={13} />
                </button>
                <button className="icon-btn" title="In der Mitte teilen" disabled={b.words.length < 2} onClick={() => setBlocks((bs) => splitBlock(bs, b.id, Math.ceil(b.words.length / 2)))}>
                  <Icon name="split" size={13} />
                </button>
                <button className="icon-btn" title="Mit nächstem Block zusammenfassen" onClick={() => setBlocks((bs) => mergeWithNext(bs, b.id))}>
                  <Icon name="merge" size={13} />
                </button>
                <button className="icon-btn" title="Block löschen" onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 18 }}>
        <Label>Neu transkribieren</Label>
        <div style={{ marginTop: 10 }}>{transcribeBox}</div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Stil & Hook */

function StylePanel({ project, update, preset, presets, presetDirty, onPresetChange, onPresetSave, onPresetDelete }: Props) {
  const [newName, setNewName] = useState('')
  const set = (patch: Partial<CaptionPreset>): void => onPresetChange({ ...preset, ...patch })
  const setHook = (patch: Partial<CaptionPreset['hook']>): void => onPresetChange({ ...preset, hook: { ...preset.hook, ...patch } })
  const builtin = DEFAULT_PRESETS.some((d) => d.id === preset.id)
  const fonts = BUNDLED_FONTS.includes(preset.fontFamily) ? BUNDLED_FONTS : [...BUNDLED_FONTS, preset.fontFamily]

  return (
    <>
      <h3>Caption-Stil</h3>
      <div className="section">
        <Field label="Kunden-Preset">
          <select className="input" value={project.presetId} onChange={(e) => update((p) => ({ ...p, presetId: e.target.value }))}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className="btn small primary" disabled={!presetDirty} onClick={() => onPresetSave()}>
            <Icon name="save" size={13} /> Speichern
          </button>
          <button className="btn small" onClick={onPresetDelete} title={builtin ? 'Auf Werkseinstellung zurücksetzen' : 'Preset löschen'}>
            {builtin ? 'Zurücksetzen' : 'Löschen'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" placeholder="Name für neues Preset (z. B. Kunde)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button
            className="btn"
            disabled={!newName.trim()}
            onClick={() => {
              onPresetSave(newName.trim())
              setNewName('')
            }}
          >
            <Icon name="plus" size={13} /> Neu
          </button>
        </div>
      </div>

      <div className="section">
        <Field label="Schrift">
          <select className="input" value={preset.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {fonts.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        <Slider label="Größe" value={preset.fontSize} min={40} max={170} step={2} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
        <Slider label="Position (von oben)" value={preset.positionY} min={0.1} max={0.92} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ positionY: v })} />
        <Slider label="Wörter pro Block" value={preset.maxWordsPerBlock} min={2} max={4} step={1} format={(v) => String(v)} hint="Gilt für neu erzeugte Blöcke." onChange={(v) => set({ maxWordsPerBlock: v })} />
        <ToggleRow label="GROSSBUCHSTABEN" on={preset.uppercase} onChange={(v) => set({ uppercase: v })} />
        <ToggleRow label="Schlüsselwort automatisch" on={preset.autoKeyword} onChange={(v) => set({ autoKeyword: v })} />
        <Field label="Animation">
          <Segmented
            value={preset.animation}
            options={[
              { value: 'pop', label: 'Pop' },
              { value: 'none', label: 'Keine' }
            ]}
            onChange={(v) => set({ animation: v })}
          />
        </Field>
      </div>

      <div className="section">
        <ColorField label="Textfarbe" value={preset.textColor} onChange={(v) => set({ textColor: v })} />
        <ColorField label="Schlüsselwort" value={preset.keywordColor} onChange={(v) => set({ keywordColor: v })} />
        <div className="field">
          <div className="field-row">
            <span>Gesprochenes Wort hervorheben (Karaoke)</span>
            <Toggle on={!!preset.activeWordColor} onChange={(on) => set({ activeWordColor: on ? '#FFD400' : '' })} />
          </div>
        </div>
        {preset.activeWordColor && <ColorField label="Farbe aktives Wort" value={preset.activeWordColor} onChange={(v) => set({ activeWordColor: v })} />}
        <ColorField label="Kontur" value={preset.outlineColor} onChange={(v) => set({ outlineColor: v })} />
        <Slider label="Konturbreite" value={preset.outlineWidth} min={0} max={16} step={0.5} format={(v) => `${v} px`} onChange={(v) => set({ outlineWidth: v })} />
        <Slider label="Schatten" value={preset.shadow} min={0} max={10} step={0.5} format={(v) => `${v} px`} onChange={(v) => set({ shadow: v })} />
      </div>

      <h3>Hook-Text</h3>
      <div className="section">
        <ToggleRow label="Hook einblenden" on={project.hook.enabled} onChange={(v) => update((p) => ({ ...p, hook: { ...p.hook, enabled: v } }))} />
        <Field label="Text">
          <textarea
            className="input"
            rows={2}
            placeholder="z. B. 3 Fehler beim Bankdrücken"
            value={project.hook.text}
            onChange={(e) => update((p) => ({ ...p, hook: { ...p.hook, text: e.target.value, enabled: p.hook.enabled || e.target.value.length > 0 } }), 'hook-text')}
          />
        </Field>
        <Slider
          label="Dauer"
          value={project.hook.durationSec}
          min={1}
          max={5}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(v) => update((p) => ({ ...p, hook: { ...p.hook, durationSec: v } }), 'hook-dur')}
        />
        <ColorField label="Balkenfarbe" value={preset.hook.barColor} onChange={(v) => setHook({ barColor: v })} />
        <ColorField label="Schriftfarbe" value={preset.hook.textColor} onChange={(v) => setHook({ textColor: v })} />
        <Slider label="Größe" value={preset.hook.fontSize} min={40} max={140} step={2} format={(v) => `${v} px`} onChange={(v) => setHook({ fontSize: v })} />
        <Slider label="Position (von oben)" value={preset.hook.positionY} min={0.06} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => setHook({ positionY: v })} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Format & Ton */

function FormatPanel({ project, update, onChooseMusic }: Props) {
  const f = project.format
  const setFormat = (patch: Partial<Project['format']>, key?: string): void => update((p) => ({ ...p, format: { ...p.format, ...patch } }), key)
  const setMusic = (patch: Partial<Project['music']>, key?: string): void => update((p) => ({ ...p, music: { ...p.music, ...patch } }), key)
  const setExport = (patch: Partial<Project['export']>): void => update((p) => ({ ...p, export: { ...p.export, ...patch } }))

  return (
    <>
      <h3>Format</h3>
      <div className="section">
        <Field label="Seitenverhältnis">
          <Segmented
            value={f.aspect}
            options={[
              { value: '9:16', label: '9:16 Reel' },
              { value: '4:5', label: '4:5 Feed' },
              { value: '16:9', label: '16:9 YouTube' }
            ]}
            onChange={(v) => setFormat({ aspect: v })}
          />
        </Field>
        <Field label="Modus">
          <Segmented
            value={f.mode}
            options={[
              { value: 'fill', label: 'Zuschneiden' },
              { value: 'blur', label: 'Einpassen + Blur' }
            ]}
            onChange={(v) => setFormat({ mode: v })}
          />
        </Field>
        <Slider label="Zoom" value={f.zoom} min={1} max={3} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => setFormat({ zoom: v }, 'zoom')} />
        {f.mode === 'fill' && (
          <>
            <Slider label="Horizontal" value={f.offsetX} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setFormat({ offsetX: v }, 'ox')} />
            <Slider label="Vertikal" value={f.offsetY} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => setFormat({ offsetY: v }, 'oy')} />
          </>
        )}
        <button className="btn small" onClick={() => setFormat({ zoom: 1, offsetX: 0, offsetY: 0 })}>
          Zentrieren
        </button>
      </div>

      <h3>Musik</h3>
      <div className="section">
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'flex-start', overflow: 'hidden' }} onClick={onChooseMusic}>
            <Icon name="music" size={14} /> {project.music.path ? baseName(project.music.path) : 'Track auswählen …'}
          </button>
          {project.music.path && (
            <button className="btn" title="Musik entfernen" onClick={() => setMusic({ path: '', enabled: false })}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        {project.music.path && (
          <>
            <ToggleRow label="Musik verwenden" on={project.music.enabled} onChange={(v) => setMusic({ enabled: v })} />
            <Slider label="Lautstärke Musik" value={project.music.volumeDb} min={-36} max={0} step={1} format={(v) => `${v} dB`} onChange={(v) => setMusic({ volumeDb: v }, 'mvol')} />
            <Field label="Ducking (leiser, wenn gesprochen wird)">
              <Segmented
                value={project.music.ducking}
                options={[
                  { value: 'off', label: 'Aus' },
                  { value: 'light', label: 'Leicht' },
                  { value: 'medium', label: 'Mittel' },
                  { value: 'strong', label: 'Stark' }
                ]}
                onChange={(v) => setMusic({ ducking: v })}
              />
            </Field>
            <p className="hint">Musik ist nur im Export und in der exakten Vorschau zu hören. Sie wird geloopt und am Ende ausgeblendet.</p>
          </>
        )}
      </div>

      <h3>Export</h3>
      <div className="section">
        <Field label="Bildrate">
          <Segmented
            value={project.export.fps}
            options={[
              { value: 30, label: '30 fps' },
              { value: 60, label: '60 fps' }
            ]}
            onChange={(v) => setExport({ fps: v })}
          />
        </Field>
        <Field label="Qualität">
          <Segmented
            value={project.export.quality}
            options={[
              { value: 'high', label: 'Hoch' },
              { value: 'max', label: 'Maximal' }
            ]}
            onChange={(v) => setExport({ quality: v })}
          />
        </Field>
        <Field label="Geschwindigkeit">
          <Segmented
            value={project.export.speed}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Schnell' }
            ]}
            onChange={(v) => setExport({ speed: v })}
          />
        </Field>
        <p className="hint">H.264 + AAC 48 kHz, Lautheit {project.export.targetLufs} LUFS (Instagram/TikTok). „Schnell" = etwas größere Datei.</p>
      </div>
    </>
  )
}
