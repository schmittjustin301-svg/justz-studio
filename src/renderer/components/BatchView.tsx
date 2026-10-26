import { useEffect, useRef, useState } from 'react'
import { findPreset, OUTPUT_SIZES, type AspectRatio, type CaptionPreset, type Project } from '../../engine'
import type { EnvironmentInfo, ProgressEvent } from '../../shared/api'
import { api, baseName, errorText, joinPath, newJobId } from '../api'
import { captionsFromTranscript, projectFromImport } from '../logic'
import { Field, Icon, Label, Progress, Segmented, ToggleRow } from './ui'

interface Item {
  id: string
  path: string
  kind: 'video' | 'project'
  status: 'wartet' | 'läuft' | 'fertig' | 'fehler'
  fraction: number
  message: string
  outPath?: string
}

interface Props {
  env: EnvironmentInfo
  presets: CaptionPreset[]
  pendingPaths: string[]
  onConsumed: () => void
}

const ASPECT_SUFFIX: Record<AspectRatio, string> = { '9:16': '9x16', '4:5': '4x5', '16:9': '16x9' }

/** Mehrere Videos oder Projekte nacheinander exportieren. Rohvideos laufen durch die Auto-Pipeline. */
export function BatchView({ env, presets, pendingPaths, onConsumed }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '')
  const [aspect, setAspect] = useState<AspectRatio>('9:16')
  const [autoCut, setAutoCut] = useState(true)
  const [autoCaptions, setAutoCaptions] = useState(Boolean(env.tools.whisper))
  const [outDir, setOutDir] = useState(env.settings.exportDir)
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const jobRef = useRef<string | null>(null)

  const add = (paths: string[]): void =>
    setItems((list) => [
      ...list,
      ...paths
        .filter((p) => !list.some((i) => i.path === p))
        .map((p) => ({ id: newJobId('item'), path: p, kind: (/\.justz$/i.test(p) ? 'project' : 'video') as Item['kind'], status: 'wartet' as const, fraction: 0, message: '' }))
    ])

  useEffect(() => {
    if (pendingPaths.length) {
      add(pendingPaths)
      onConsumed()
    }
  }, [pendingPaths, onConsumed])

  const patch = (id: string, p: Partial<Item>): void => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)))
  const whisperReady = Boolean(env.tools.whisper) && env.models.some((m) => m.id === env.settings.whisperModel && m.installed)

  async function processItem(item: Item, dir: string): Promise<void> {
    const preset = findPreset(presets, presetId)
    const jobId = newJobId('batch')
    jobRef.current = jobId
    const off = api().onProgress((e: ProgressEvent) => {
      if (e.jobId === jobId) patch(item.id, { fraction: e.fraction, message: e.message })
    })
    try {
      let project: Project
      let usedPreset = preset
      if (item.kind === 'project') {
        project = (await api().loadProject(item.path)).project
        usedPreset = findPreset(presets, project.presetId)
      } else {
        patch(item.id, { message: 'Analyse' })
        const imported = await api().importMedia(jobId, item.path)
        project = projectFromImport(imported, preset)
        project.format.aspect = aspect
        if (!autoCut) project.cuts = project.cuts.map((c) => ({ ...c, enabled: false }))
        if (autoCaptions && whisperReady && project.media) {
          patch(item.id, { message: 'Transkription' })
          const t = await api().transcribe(jobId, project.media, env.settings.language, env.settings.whisperModel)
          project = captionsFromTranscript(project, t, preset)
        }
      }
      const out = joinPath(dir, `${baseName(item.path)}_${ASPECT_SUFFIX[project.format.aspect]}.mp4`)
      const res = await api().exportVideo(jobId, project, usedPreset, out)
      patch(item.id, { status: 'fertig', fraction: 1, message: `${OUTPUT_SIZES[project.format.aspect].width}×${OUTPUT_SIZES[project.format.aspect].height} · ${Math.round(res.duration)} s`, outPath: res.outPath })
    } finally {
      off()
      jobRef.current = null
    }
  }

  async function start(): Promise<void> {
    let dir = outDir
    if (!dir) {
      const d = await api().chooseFolder()
      if (!d) return
      dir = d
      setOutDir(d)
    }
    setRunning(true)
    stopRef.current = false
    for (const item of items) {
      if (stopRef.current) break
      if (item.status === 'fertig') continue
      patch(item.id, { status: 'läuft', fraction: 0, message: 'Start' })
      try {
        await processItem(item, dir)
      } catch (e) {
        patch(item.id, { status: 'fehler', message: errorText(e) })
      }
    }
    setRunning(false)
  }

  const done = items.filter((i) => i.status === 'fertig').length

  return (
    <div className="batch">
      <div
        className="batch-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          add(Array.from(e.dataTransfer.files).map((f) => api().pathForFile(f)).filter((p) => /\.(mp4|mov|m4v|justz)$/i.test(p)))
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <h2 className="headline" style={{ margin: 0, fontSize: 30 }}>
            Batch-Export
          </h2>
          <span className="hint" style={{ flex: 1 }}>
            {items.length} Einträge · {done} fertig
          </span>
          <button className="btn" disabled={running} onClick={async () => add(await api().chooseVideo())}>
            <Icon name="plus" size={14} /> Videos
          </button>
          <button className="btn" disabled={running} onClick={async () => add(await api().openProjectDialog())}>
            <Icon name="folder" size={14} /> Projekte
          </button>
          <button className="btn ghost" disabled={running || items.length === 0} onClick={() => setItems([])}>
            Liste leeren
          </button>
        </div>
        {items.length === 0 && (
          <div className="dropzone" style={{ margin: 0, minHeight: 300 }}>
            <div className="headline">
              Videos oder <em>Projekte</em> hierher ziehen
            </div>
            <span className="hint">Rohvideos laufen automatisch durch Pausenschnitt → Transkription → Untertitel → Export.</span>
          </div>
        )}
        {items.map((it, i) => (
          <div className="card batch-item" key={it.id}>
            <span className="label">{String(i + 1).padStart(2, '0')}</span>
            <div style={{ minWidth: 0 }}>
              <div className="name">{baseName(it.path)}</div>
              <div className="hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={it.message}>
                {it.kind === 'project' ? 'Projekt' : 'Rohvideo'} {it.message && `· ${it.message}`}
              </div>
            </div>
            <div>{it.status === 'läuft' && <Progress value={it.fraction} />}</div>
            <div style={{ textAlign: 'right' }}>
              {it.status === 'fertig' && it.outPath ? (
                <button className="btn small" onClick={() => api().showInFolder(it.outPath!)}>
                  Zeigen
                </button>
              ) : (
                <span className={`badge ${it.status === 'fertig' ? 'done' : it.status === 'fehler' ? 'error' : it.status === 'läuft' ? 'running' : ''}`}>{it.status}</span>
              )}
              {!running && it.status !== 'läuft' && (
                <button className="icon-btn" style={{ display: 'inline-grid', marginLeft: 4 }} title="Entfernen" onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <aside className="inspector" style={{ gridRow: 'auto', gridColumn: 'auto' }}>
        <div className="inspector-body">
          <h3>Einstellungen für Rohvideos</h3>
          <Field label="Kunden-Preset">
            <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <Segmented
              value={aspect}
              options={[
                { value: '9:16', label: '9:16' },
                { value: '4:5', label: '4:5' },
                { value: '16:9', label: '16:9' }
              ]}
              onChange={setAspect}
            />
          </Field>
          <ToggleRow label="Pausen automatisch schneiden" on={autoCut} onChange={setAutoCut} />
          <ToggleRow
            label="Untertitel automatisch"
            on={autoCaptions && whisperReady}
            onChange={setAutoCaptions}
            hint={whisperReady ? `Whisper-Modell: ${env.settings.whisperModel}, Sprache: ${env.settings.language}` : 'Dafür whisper.cpp installieren und in den Einstellungen das Modell laden.'}
          />
          <p className="hint">Projekte (.justz) werden mit ihren eigenen Einstellungen exportiert.</p>
          <Field label="Zielordner">
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" readOnly value={outDir} placeholder="bitte wählen" />
              <button
                className="btn"
                onClick={async () => {
                  const d = await api().chooseFolder()
                  if (d) setOutDir(d)
                }}
              >
                <Icon name="folder" size={14} />
              </button>
            </div>
          </Field>
          {running ? (
            <button
              className="btn block big"
              onClick={() => {
                stopRef.current = true
                if (jobRef.current) void api().cancel(jobRef.current)
              }}
            >
              Abbrechen
            </button>
          ) : (
            <button className="btn primary block big" disabled={items.filter((i) => i.status !== 'fertig').length === 0} onClick={start}>
              <Icon name="export" /> Batch starten
            </button>
          )}
          <div style={{ marginTop: 16 }}>
            <Label>Ausgabe</Label>
            <p className="hint">Dateiname_9x16.mp4 · H.264/AAC · -14 LUFS</p>
          </div>
        </div>
      </aside>
    </div>
  )
}
