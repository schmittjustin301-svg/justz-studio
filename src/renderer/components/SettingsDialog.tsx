import { useState } from 'react'
import type { AppSettings, EnvironmentInfo } from '../../shared/api'
import { Field, Icon, Segmented } from './ui'

interface Props {
  env: EnvironmentInfo
  onClose: () => void
  onSave: (s: Partial<AppSettings>) => Promise<void>
  onDownloadModel: (id: string) => void
  onChooseFolder: () => Promise<string | null>
}

export function SettingsDialog({ env, onClose, onSave, onDownloadModel, onChooseFolder }: Props) {
  const [s, setS] = useState<AppSettings>(env.settings)
  const t = env.tools
  const row = (name: string, path: string | null, extra?: string) => (
    <div className="tool-row">
      <span>
        <span className={`dot ${path ? 'ok' : 'bad'}`} />
        {name}
      </span>
      <span className="mono" title={path ?? ''}>
        {path ?? 'nicht gefunden'}
      </span>
      <span className="hint">{extra}</span>
    </div>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Einstellungen</h2>

        <Field label="Programme">
          <div>
            {row('FFmpeg', t.ffmpeg, t.ffmpegVersion)}
            {row('FFprobe', t.ffprobe)}
            {row('whisper.cpp', t.whisper)}
          </div>
        </Field>
        {t.problems.map((p, i) => (
          <div key={i} className={`notice ${p.severity}`}>
            {p.message}
          </div>
        ))}
        <details style={{ marginBottom: 18 }}>
          <summary className="hint" style={{ cursor: 'pointer' }}>
            Eigene Programmpfade (nur nötig, wenn nicht über Homebrew installiert)
          </summary>
          <div style={{ marginTop: 12 }}>
            <Field label="FFmpeg">
              <input className="input" placeholder="/opt/homebrew/bin/ffmpeg" value={s.ffmpegPath} onChange={(e) => setS({ ...s, ffmpegPath: e.target.value })} />
            </Field>
            <Field label="FFprobe">
              <input className="input" placeholder="/opt/homebrew/bin/ffprobe" value={s.ffprobePath} onChange={(e) => setS({ ...s, ffprobePath: e.target.value })} />
            </Field>
            <Field label="whisper-cli">
              <input className="input" placeholder="/opt/homebrew/bin/whisper-cli" value={s.whisperPath} onChange={(e) => setS({ ...s, whisperPath: e.target.value })} />
            </Field>
          </div>
        </details>

        <Field label="Transkription – Standardsprache">
          <Segmented
            value={s.language}
            options={[
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'Englisch' },
              { value: 'auto', label: 'Automatisch' }
            ]}
            onChange={(v) => setS({ ...s, language: v })}
          />
        </Field>
        <Field label="Whisper-Modelle" hint="Modelle werden einmalig von Hugging Face geladen und lokal gespeichert. Danach läuft alles offline.">
          <div>
            {env.models.map((m) => (
              <div className="tool-row" key={m.id} style={{ gridTemplateColumns: '24px 1fr auto auto' }}>
                <input type="radio" name="model" checked={s.whisperModel === m.id} onChange={() => setS({ ...s, whisperModel: m.id })} />
                <span>
                  <b>{m.label}</b> <span className="hint">· {m.note}</span>
                </span>
                <span className="hint">{m.sizeMb} MB</span>
                {m.installed ? (
                  <span className="badge done">installiert</span>
                ) : (
                  <button className="btn small" onClick={() => onDownloadModel(m.id)}>
                    Laden
                  </button>
                )}
              </div>
            ))}
          </div>
        </Field>
        <Field label="Standard-Exportordner">
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" placeholder="Filme-Ordner" value={s.exportDir} onChange={(e) => setS({ ...s, exportDir: e.target.value })} />
            <button
              className="btn"
              onClick={async () => {
                const d = await onChooseFolder()
                if (d) setS({ ...s, exportDir: d })
              }}
            >
              <Icon name="folder" size={14} />
            </button>
          </div>
        </Field>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }}>
          <span className="hint">JUSTZ Studio {env.version}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                await onSave(s)
                onClose()
              }}
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
