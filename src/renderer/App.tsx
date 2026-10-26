import { useCallback, useEffect, useRef, useState } from 'react'
import { createProject, DEFAULT_PRESETS, describeMedia, findPreset, type CaptionPreset, type Envelope, type Project } from '../engine'
import type { EnvironmentInfo, MenuAction } from '../shared/api'
import { api, baseName, errorText, newJobId } from './api'
import { BatchView } from './components/BatchView'
import { Inspector, type Update } from './components/Inspector'
import { Preview, type PreviewHandle } from './components/Preview'
import { SettingsDialog } from './components/SettingsDialog'
import { Timeline } from './components/Timeline'
import { Icon, Logo, Progress } from './components/ui'
import { captionsFromTranscript, projectFromImport, toEnvelope } from './logic'

interface Busy {
  jobId: string
  title: string
  fraction: number
  message: string
  cancellable: boolean
}

interface Toast {
  text: string
  kind: 'info' | 'error'
  action?: { label: string; run: () => void }
}

const VIDEO_RE = /\.(mp4|mov|m4v)$/i
const ASPECT_SUFFIX = { '9:16': '9x16', '4:5': '4x5', '16:9': '16x9' } as const

export function App() {
  const [env, setEnv] = useState<EnvironmentInfo | null>(null)
  const [presets, setPresets] = useState<CaptionPreset[]>(DEFAULT_PRESETS)
  const [dirtyPresets, setDirtyPresets] = useState<Set<string>>(new Set())
  const [project, setProjectState] = useState<Project>(() => createProject())
  const projectRef = useRef(project)
  const history = useRef({ past: [] as Project[], future: [] as Project[], key: '', at: 0 })
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [analysis, setAnalysis] = useState<{ proxyUrl: string; envelope: Envelope } | null>(null)
  const [view, setView] = useState<'editor' | 'batch'>('editor')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [frame, setFrame] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [batchPaths, setBatchPaths] = useState<string[]>([])
  const [coarseTime, setCoarseTime] = useState(0)
  const timeRef = useRef(0)
  const previewRef = useRef<PreviewHandle>(null)

  const preset = findPreset(presets, project.presetId)

  // ---------- Projektzustand mit Rückgängig ----------

  const replaceProject = useCallback((p: Project, isDirty: boolean) => {
    projectRef.current = p
    history.current = { past: [], future: [], key: '', at: 0 }
    setProjectState(p)
    setDirty(isDirty)
  }, [])

  const update: Update = useCallback((fn, key) => {
    const prev = projectRef.current
    const next = fn(prev)
    if (next === prev) return
    const h = history.current
    const now = Date.now()
    // Schieberegler-Bewegungen zu einem Rückgängig-Schritt zusammenfassen
    if (!(key && h.key === key && now - h.at < 800)) {
      h.past.push(prev)
      if (h.past.length > 100) h.past.shift()
    }
    h.future = []
    h.key = key ?? ''
    h.at = now
    projectRef.current = next
    setProjectState(next)
    setDirty(true)
  }, [])

  const undo = useCallback((redo = false) => {
    const h = history.current
    const from = redo ? h.future : h.past
    const to = redo ? h.past : h.future
    const p = from.pop()
    if (!p) return
    to.push(projectRef.current)
    h.key = ''
    projectRef.current = p
    setProjectState(p)
    setDirty(true)
  }, [])

  // ---------- Hilfen ----------

  const showToast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    setToast({ text, kind, action })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 12000 : 6000)
    return () => clearTimeout(t)
  }, [toast])

  const runJob = useCallback(
    async <T,>(title: string, fn: (jobId: string) => Promise<T>, cancellable = true): Promise<T | null> => {
      const jobId = newJobId('job')
      setBusy({ jobId, title, fraction: 0, message: '', cancellable })
      try {
        return await fn(jobId)
      } catch (e) {
        const msg = errorText(e)
        if (msg !== 'Abgebrochen') showToast(msg, 'error')
        return null
      } finally {
        setBusy(null)
      }
    },
    [showToast]
  )

  useEffect(() => {
    void api().getEnvironment().then(setEnv)
    void api().listPresets().then(setPresets)
    return api().onProgress((e) => setBusy((b) => (b && b.jobId === e.jobId ? { ...b, fraction: e.fraction, message: e.message } : b)))
  }, [])

  const confirmDiscard = (): boolean => !dirty || !projectRef.current.media || confirm('Ungespeicherte Änderungen verwerfen?')

  // ---------- Aktionen ----------

  const importVideo = async (path: string): Promise<void> => {
    if (!confirmDiscard()) return
    const r = await runJob('Video wird importiert', (jobId) => api().importMedia(jobId, path))
    if (!r) return
    replaceProject(projectFromImport(r, preset), true)
    setAnalysis({ proxyUrl: r.proxyUrl, envelope: toEnvelope(r.envelope) })
    setProjectPath(null)
    setView('editor')
  }

  const openProject = async (path?: string): Promise<void> => {
    if (!confirmDiscard()) return
    const target = path ?? (await api().openProjectDialog())[0]
    if (!target) return
    await runJob('Projekt wird geöffnet', async (jobId) => {
      const { project: p } = await api().loadProject(target)
      if (!p.media) throw new Error('Das Projekt enthält kein Video.')
      const r = await api().importMedia(jobId, p.media.path)
      replaceProject({ ...p, media: r.media }, false)
      setAnalysis({ proxyUrl: r.proxyUrl, envelope: toEnvelope(r.envelope) })
      setProjectPath(target)
      setView('editor')
    })
  }

  const save = async (as = false): Promise<void> => {
    if (!projectRef.current.media) return
    try {
      const path = await api().saveProject(projectRef.current, as ? null : projectPath)
      if (!path) return
      setProjectPath(path)
      setDirty(false)
      showToast(`Gespeichert: ${baseName(path)}`)
    } catch (e) {
      showToast(errorText(e), 'error')
    }
  }

  const newProject = (): void => {
    if (!confirmDiscard()) return
    replaceProject(createProject(), false)
    setAnalysis(null)
    setProjectPath(null)
  }

  const transcribe = async (language: string, model: string): Promise<void> => {
    if (!env || !project.media) return
    const info = env.models.find((m) => m.id === model)
    if (info && !info.installed) {
      if (!confirm(`Das Modell "${info.label}" (${info.sizeMb} MB) wird jetzt einmalig heruntergeladen. Fortfahren?`)) return
      const newEnv = await runJob('Whisper-Modell wird geladen', (jobId) => api().downloadModel(jobId, model))
      if (!newEnv) return
      setEnv(newEnv)
    }
    if (project.captions.length && !confirm('Vorhandene Untertitel werden ersetzt. Fortfahren?')) return
    const media = project.media
    const t = await runJob('Transkription läuft', (jobId) => api().transcribe(jobId, media, language, model))
    if (!t) return
    if (t.words.length === 0) return showToast('Kein gesprochener Text erkannt.', 'error')
    update((p) => captionsFromTranscript(p, t, preset))
    showToast(`${t.words.length} Wörter erkannt (${t.language.toUpperCase()}).`)
  }

  const exportVideo = async (): Promise<void> => {
    const p = projectRef.current
    if (!p.media) return
    previewRef.current?.pause()
    const out = await api().chooseExportPath(`${p.name || baseName(p.media.path)}_${ASPECT_SUFFIX[p.format.aspect]}.mp4`)
    if (!out) return
    const res = await runJob('Export läuft', (jobId) => api().exportVideo(jobId, p, preset, out))
    if (res) showToast(`Export fertig: ${baseName(res.outPath)}.mp4 · ${Math.round(res.duration)} s · -14 LUFS`, 'info', { label: 'Im Finder zeigen', run: () => void api().showInFolder(res.outPath) })
  }

  const exactFrame = async (t: number): Promise<void> => {
    previewRef.current?.pause()
    const url = await runJob('Vorschau wird gerendert', () => api().previewFrame(projectRef.current, preset, t), false)
    if (url) setFrame(url)
  }

  const chooseMusic = async (): Promise<void> => {
    const path = await api().chooseMusic()
    if (path) update((p) => ({ ...p, music: { ...p.music, path, enabled: true } }))
  }

  const changePreset = (p: CaptionPreset): void => {
    setPresets((list) => list.map((x) => (x.id === p.id ? p : x)))
    setDirtyPresets((s) => new Set(s).add(p.id))
  }

  const savePreset = async (asNewName?: string): Promise<void> => {
    let p = preset
    if (asNewName) {
      const slug = asNewName.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '')
      p = { ...preset, id: `${slug || 'preset'}-${Date.now().toString(36)}`, name: asNewName }
    }
    const list = await api().savePreset(p)
    // ungespeicherte Änderungen an anderen Presets behalten
    setPresets(list.map((x) => (x.id !== p.id && dirtyPresets.has(x.id) ? (presets.find((y) => y.id === x.id) ?? x) : x)))
    setDirtyPresets((s) => {
      const n = new Set(s)
      n.delete(preset.id)
      return n
    })
    if (asNewName) update((pr) => ({ ...pr, presetId: p.id }))
    showToast(`Preset „${p.name}" gespeichert.`)
  }

  const deletePreset = async (): Promise<void> => {
    const builtin = DEFAULT_PRESETS.some((d) => d.id === preset.id)
    if (!confirm(builtin ? `„${preset.name}" auf Werkseinstellung zurücksetzen?` : `Preset „${preset.name}" löschen?`)) return
    const list = await api().deletePreset(preset.id)
    setPresets(list)
    setDirtyPresets((s) => {
      const n = new Set(s)
      n.delete(preset.id)
      return n
    })
    if (!builtin) update((pr) => ({ ...pr, presetId: list[0].id }))
  }

  const handlePaths = (paths: string[]): void => {
    const projects = paths.filter((p) => /\.justz$/i.test(p))
    const videos = paths.filter((p) => VIDEO_RE.test(p))
    if (projects.length + videos.length > 1) {
      setBatchPaths([...videos, ...projects])
      setView('batch')
      return
    }
    if (projects[0]) void openProject(projects[0])
    else if (videos[0]) void importVideo(videos[0])
    else if (paths.length) showToast('Nur MP4/MOV-Videos und .justz-Projekte werden unterstützt.', 'error')
  }

  // ---------- Tastatur, Menü, Drag & Drop ----------

  const actions = useRef({ save, exportVideo, openProject, newProject, undo })
  actions.current = { save, exportVideo, openProject, newProject, undo }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        actions.current.undo(e.shiftKey)
      } else if (e.code === 'Space' && !typing) {
        e.preventDefault()
        previewRef.current?.toggle()
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing) {
        previewRef.current?.seek(timeRef.current + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(
    () =>
      api().onMenu((a: MenuAction) => {
        const x = actions.current
        if (a === 'new') x.newProject()
        if (a === 'open') void x.openProject()
        if (a === 'save') void x.save()
        if (a === 'save-as') void x.save(true)
        if (a === 'export') void x.exportVideo()
        if (a === 'settings') setSettingsOpen(true)
      }),
    []
  )

  const onTime = useCallback((t: number) => {
    timeRef.current = t
    setCoarseTime((c) => (Math.abs(c - t) > 0.12 ? t : c))
  }, [])

  const hasMedia = Boolean(project.media && analysis)
  const blocking = env?.tools.problems.filter((p) => p.severity === 'error') ?? []

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        if (view === 'editor') setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (view === 'batch') return
        handlePaths(Array.from(e.dataTransfer.files).map((f) => api().pathForFile(f)))
      }}
    >
      <header className="topbar">
        <Logo url={env?.logoUrl ?? null} />
        <nav className="tabs-main">
          <button className={view === 'editor' ? 'active' : ''} onClick={() => setView('editor')}>
            EDITOR
          </button>
          <button className={view === 'batch' ? 'active' : ''} onClick={() => setView('batch')}>
            BATCH
          </button>
        </nav>
        {view === 'editor' && hasMedia && (
          <>
            <input className="project-name" value={project.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }), 'name')} title="Projektname" />
            {dirty && <span className="dirty" title="Ungespeicherte Änderungen">●</span>}
          </>
        )}
        <div className="spacer" />
        {view === 'editor' && (
          <>
            <button className="btn ghost" onClick={() => undo()} title="Rückgängig (⌘Z)" disabled={!hasMedia}>
              <Icon name="undo" size={15} />
            </button>
            <button className="btn ghost" onClick={newProject} title="Neues Projekt (⌘N)">
              Neu
            </button>
            <button className="btn ghost" onClick={() => void openProject()} title="Projekt öffnen (⌘O)">
              <Icon name="folder" size={14} /> Öffnen
            </button>
            <button className="btn" onClick={() => void save()} disabled={!hasMedia} title="Speichern (⌘S)">
              <Icon name="save" size={14} /> Speichern
            </button>
            <button className="btn primary" onClick={() => void exportVideo()} disabled={!hasMedia} title="Exportieren (⌘E)">
              <Icon name="export" size={14} /> Export
            </button>
          </>
        )}
        <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Einstellungen">
          <Icon name="settings" size={16} />
        </button>
      </header>

      {view === 'batch' && env ? (
        <BatchView env={env} presets={presets} pendingPaths={batchPaths} onConsumed={() => setBatchPaths([])} />
      ) : hasMedia && env ? (
        <main className="editor">
          <section className="stage">
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <span className="label">
                {baseName(project.media!.path)} · {describeMedia(project.media!)}
              </span>
            </div>
            <Preview ref={previewRef} project={project} preset={preset} proxyUrl={analysis!.proxyUrl} onTime={onTime} onExactFrame={(t) => void exactFrame(t)} />
          </section>
          <Inspector
            project={project}
            update={update}
            envelope={analysis!.envelope}
            env={env}
            preset={preset}
            presets={presets}
            presetDirty={dirtyPresets.has(preset.id)}
            onPresetChange={changePreset}
            onPresetSave={(n) => void savePreset(n)}
            onPresetDelete={() => void deletePreset()}
            time={coarseTime}
            seek={(t) => previewRef.current?.seek(t)}
            onTranscribe={(l, m) => void transcribe(l, m)}
            onChooseMusic={() => void chooseMusic()}
          />
          <Timeline
            project={project}
            envelope={analysis!.envelope}
            timeRef={timeRef}
            onSeek={(t) => previewRef.current?.seek(t)}
            onToggleCut={(id) => update((p) => ({ ...p, cuts: p.cuts.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)) }))}
          />
        </main>
      ) : (
        <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className={`dropzone ${dragOver ? 'over' : ''}`}>
            <div className="label">JUSTZ Studio</div>
            <div className="headline">
              Video hier <em>reinziehen</em>
            </div>
            <span className="hint">MP4 oder MOV – auch direkt vom iPhone (HEVC, 60 fps, HDR). Mehrere Dateien → Batch.</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="btn primary big" onClick={async () => handlePaths(await api().chooseVideo())}>
                <Icon name="upload" /> Video auswählen
              </button>
              <button className="btn big" onClick={() => void openProject()}>
                <Icon name="folder" /> Projekt öffnen
              </button>
            </div>
            <div style={{ maxWidth: 520, marginTop: 10 }}>
              {blocking.map((p, i) => (
                <div key={i} className="notice error">
                  {p.message}
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {dragOver && hasMedia && view === 'editor' && (
        <div className="drop-overlay">
          <div className="headline" style={{ fontSize: 36 }}>
            Loslassen zum Importieren
          </div>
        </div>
      )}

      {busy && (
        <div className="busy" style={{ position: 'fixed' }}>
          <div className="headline" style={{ fontSize: 28 }}>
            {busy.title}
          </div>
          <Progress value={busy.fraction} />
          <span className="hint">
            {busy.message} {busy.fraction > 0 && `· ${Math.round(busy.fraction * 100)} %`}
          </span>
          {busy.cancellable && (
            <button className="btn small" onClick={() => void api().cancel(busy.jobId)}>
              Abbrechen
            </button>
          )}
        </div>
      )}

      {frame && (
        <div className="frame-modal" onClick={() => setFrame(null)}>
          <img src={frame} alt="Exakte Vorschau" />
        </div>
      )}

      {settingsOpen && env && (
        <SettingsDialog
          env={env}
          onClose={() => setSettingsOpen(false)}
          onSave={async (s) => setEnv(await api().saveSettings(s))}
          onChooseFolder={() => api().chooseFolder()}
          onDownloadModel={async (id) => {
            const e = await runJob('Whisper-Modell wird geladen', (jobId) => api().downloadModel(jobId, id))
            if (e) setEnv(e)
          }}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          {toast.action && (
            <button className="btn small" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
          <button className="icon-btn" onClick={() => setToast(null)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
