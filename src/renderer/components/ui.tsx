import type { CSSProperties, ReactNode } from 'react'

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  hint?: string
  onChange: (v: number) => void
}

export function Slider({ label, value, min, max, step, format, hint, onChange }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className="field">
      <div className="field-row">
        <Label>{label}</Label>
        <span className="value">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Toggle({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <button type="button" title={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />
}

export function ToggleRow({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="field">
      <div className="field-row">
        <span>{label}</span>
        <Toggle on={on} onChange={onChange} />
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <Label>{label}</Label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="color-input">
        <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  )
}

const ICONS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  cut: 'M9.6 8.2A3 3 0 1 0 8 9.4L10.6 12 8 14.6a3 3 0 1 0 1.6 1.2L12 13.4l7 7h2v-1L9.6 8.2zM6 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm15-14h-2l-5.6 5.6 1.4 1.4L21 5z',
  upload: 'M12 3l5 5h-3v6h-4V8H7zM5 18h14v2H5z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 2v5h9V5zm5 9a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  export: 'M12 3l5 5h-3v7h-4V8H7zM4 17h16v4H4z',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9 4.6v-2.2l-2.4-.6a7 7 0 0 0-.7-1.6l1.3-2.1-1.6-1.6-2.1 1.3a7 7 0 0 0-1.6-.7L13.3 3h-2.2l-.6 2.4a7 7 0 0 0-1.6.7L6.8 4.8 5.2 6.4l1.3 2.1a7 7 0 0 0-.7 1.6L3 10.9v2.2l2.4.6c.2.6.4 1.1.7 1.6l-1.3 2.1 1.6 1.6 2.1-1.3c.5.3 1 .5 1.6.7l.6 2.6h2.2l.6-2.4c.6-.2 1.1-.4 1.6-.7l2.1 1.3 1.6-1.6-1.3-2.1c.3-.5.5-1 .7-1.6z',
  x: 'M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  check: 'M9 16.2l-4.2-4.2L3.4 13.4 9 19 21 7l-1.4-1.4z',
  wand: 'M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.6 5.3a1 1 0 0 0-1.4 0L1.3 18.9a1 1 0 0 0 0 1.4l2.4 2.4a1 1 0 0 0 1.4 0L16.7 11a1 1 0 0 0 0-1.4zm-1 5.5l-2.1-2.1 2.4-2.4 2.1 2.1z',
  split: 'M11 3h2v18h-2zM4 8l4 4-4 4zm16 0v8l-4-4z',
  merge: 'M4 11h16v2H4zM8 4l4 4 4-4zm0 16l4-4 4 4z',
  trash: 'M6 7h12l-1 14H7zm3-4h6l1 2h4v2H4V5h4z',
  edit: 'M3 17.2V21h3.8l11-11-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z',
  film: 'M4 4h16v16H4zm2 2v2h2V6zm10 0v2h2V6zM6 10v4h12v-4zm0 6v2h2v-2zm10 0v2h2v-2z',
  image: 'M4 5h16v14H4zm2 2v8l4-4 3 3 2-2 3 3V7zm9 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  undo: 'M12.5 8A8.5 8.5 0 0 0 4 13l-2-2v6h6l-2.3-2.3A6.5 6.5 0 0 1 18.9 16l1.9-.6A8.5 8.5 0 0 0 12.5 8z',
  music: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z'
}

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={ICONS[name] ?? ''} />
    </svg>
  )
}

export function Logo({ url }: { url: string | null }) {
  if (url)
    return (
      <div className="logo">
        <img src={url} alt="JUSTZ Media Works" />
      </div>
    )
  return (
    <div className="logo wordmark" title="JUSTZ Media Works">
      <span className="big">
        JUST<span className="z">Z</span>
      </span>
      <span className="small">MEDIA WORKS</span>
    </div>
  )
}
