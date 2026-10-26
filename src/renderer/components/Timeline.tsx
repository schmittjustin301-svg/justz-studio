import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { blockEnd, blockStart, keepSegments, outputDuration, waveformPeaks, type Envelope, type Project } from '../../engine'
import { formatTime } from '../api'

interface Props {
  project: Project
  envelope: Envelope
  timeRef: MutableRefObject<number>
  onSeek: (t: number) => void
  onToggleCut: (id: string) => void
}

const RULER = 20
const CAPTION_LANE = 26
const COLORS = {
  bg: '#141518',
  ruler: '#1b1c20',
  line: '#2c2e33',
  text: '#a6abb2',
  wave: '#c9ccd1',
  waveCut: '#5a5d63',
  red: '#e01e26',
  redFill: 'rgba(224,30,38,0.22)',
  caption: '#26282d',
  captionKw: 'rgba(224,30,38,0.55)'
}

/**
 * Zeichnet nur den sichtbaren Ausschnitt (Canvas = Fensterbreite), damit auch lange Videos mit hoher
 * Zoomstufe funktionieren. Gescrollt wird über einen unsichtbaren Platzhalter in voller Breite.
 */
export function Timeline({ project, envelope, timeRef, onSeek, onToggleCut }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ width: 800, height: 150, scroll: 0 })
  const [hoverCut, setHoverCut] = useState<string | null>(null)
  const duration = project.media!.duration
  const basePps = Math.max(20, (view.width - 20) / duration)
  const pps = basePps * zoom
  const fullWidth = Math.ceil(duration * pps) + 20

  const segments = useMemo(() => keepSegments(duration, project.cuts), [duration, project.cuts])
  const peaks = useMemo(() => waveformPeaks(envelope, Math.max(1, Math.round(fullWidth))), [envelope, fullWidth])
  const cutCount = project.cuts.filter((c) => c.enabled).length
  const saved = duration - outputDuration(segments)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const W = view.width
    const H = view.height
    if (c.width !== W * dpr || c.height !== H * dpr) {
      c.width = W * dpr
      c.height = H * dpr
      c.style.width = `${W}px`
      c.style.height = `${H}px`
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, W, H)
    const x0 = view.scroll
    const tx = (t: number): number => t * pps - x0 + 10
    const waveTop = RULER + 4
    const waveH = H - RULER - CAPTION_LANE - 8
    const mid = waveTop + waveH / 2

    // Lineal
    ctx.fillStyle = COLORS.ruler
    ctx.fillRect(0, 0, W, RULER)
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120]
    const step = steps.find((s) => s * pps >= 70) ?? 300
    ctx.fillStyle = COLORS.text
    ctx.font = '10px Inter, sans-serif'
    ctx.strokeStyle = COLORS.line
    for (let t = Math.floor((x0 / pps) / step) * step; t <= duration; t += step) {
      const x = Math.round(tx(t)) + 0.5
      if (x > W) break
      ctx.beginPath()
      ctx.moveTo(x, RULER - 6)
      ctx.lineTo(x, RULER)
      ctx.stroke()
      ctx.fillText(formatTime(t, step < 1), x + 3, 13)
    }

    // Waveform
    const perPx = peaks.length / fullWidth
    for (let x = 0; x < W; x++) {
      const gx = x + x0 - 10
      if (gx < 0 || gx >= fullWidth - 20) continue
      const t = gx / pps
      const p = peaks[Math.min(peaks.length - 1, Math.floor(gx * perPx))]
      const inCut = project.cuts.some((cut) => cut.enabled && t >= cut.start && t < cut.end)
      ctx.fillStyle = inCut ? COLORS.waveCut : COLORS.wave
      const h = Math.max(1, p * waveH * 0.95)
      ctx.fillRect(x, mid - h / 2, 1, h)
    }

    // Schnitte
    for (const cut of project.cuts) {
      const a = tx(cut.start)
      const b = tx(cut.end)
      if (b < 0 || a > W) continue
      const hovered = hoverCut === cut.id
      if (cut.enabled) {
        ctx.fillStyle = hovered ? 'rgba(224,30,38,0.38)' : COLORS.redFill
        ctx.fillRect(a, waveTop, b - a, waveH)
        ctx.fillStyle = COLORS.red
        ctx.fillRect(a, waveTop, 1.5, waveH)
        ctx.fillRect(b - 1.5, waveTop, 1.5, waveH)
        if (b - a > 14) {
          ctx.fillStyle = '#fff'
          ctx.font = '10px Inter, sans-serif'
          ctx.fillText('✂', a + (b - a) / 2 - 4, waveTop + 12)
        }
      } else {
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = hovered ? COLORS.red : '#6b6e75'
        ctx.strokeRect(a + 0.5, waveTop + 0.5, b - a - 1, waveH - 1)
        ctx.setLineDash([])
      }
    }

    // Untertitel-Spur
    const laneY = H - CAPTION_LANE
    ctx.fillStyle = COLORS.ruler
    ctx.fillRect(0, laneY, W, CAPTION_LANE)
    ctx.font = '600 10px Inter, sans-serif'
    for (const b of project.captions) {
      if (!b.words.length) continue
      const a = tx(blockStart(b))
      const e = tx(blockEnd(b))
      if (e < 0 || a > W) continue
      ctx.fillStyle = b.words.some((w) => w.keyword) ? COLORS.captionKw : COLORS.caption
      ctx.fillRect(a, laneY + 4, Math.max(2, e - a - 1), CAPTION_LANE - 8)
      if (e - a > 24) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(a, laneY, e - a - 3, CAPTION_LANE)
        ctx.clip()
        ctx.fillStyle = '#f2f2f2'
        ctx.fillText(b.words.map((w) => w.text).join(' '), a + 4, laneY + 16)
        ctx.restore()
      }
    }

    // Abspielposition
    const px = Math.round(tx(timeRef.current)) + 0.5
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, H)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.fillStyle = COLORS.red
    ctx.beginPath()
    ctx.moveTo(px - 6, 0)
    ctx.lineTo(px + 6, 0)
    ctx.lineTo(px, 8)
    ctx.fill()
  }, [view, pps, fullWidth, duration, peaks, project.cuts, project.captions, hoverCut, timeRef])

  // Neu zeichnen bei jeder Zeitänderung; beim Abspielen der Position folgen
  useEffect(() => {
    let raf = 0
    let last = -1
    const loop = (): void => {
      const t = timeRef.current
      if (t !== last) {
        last = t
        const el = scrollRef.current
        if (el) {
          const x = t * pps + 10
          if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 60)
        }
        draw()
      }
      raf = requestAnimationFrame(loop)
    }
    draw()
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw, pps, timeRef])

  const hitCut = (clientX: number, clientY: number): string | null => {
    const r = canvasRef.current!.getBoundingClientRect()
    const y = clientY - r.top
    if (y < RULER || y > r.height - CAPTION_LANE) return null
    const t = (clientX - r.left + view.scroll - 10) / pps
    return project.cuts.find((c) => t >= c.start && t <= c.end)?.id ?? null
  }

  return (
    <div className="timeline">
      <div className="timeline-head">
        <span className="label">Timeline</span>
        <span className="hint">
          {cutCount} Schnitte · {formatTime(saved, true)} gespart
        </span>
        <div className="legend">
          <span>
            <i style={{ background: COLORS.redFill, border: `1px solid ${COLORS.red}` }} />
            wird geschnitten
          </span>
          <span>
            <i style={{ border: '1px dashed #6b6e75' }} />
            Schnitt aus
          </span>
          <span>Klick auf Schnitt = an/aus</span>
          <span className="label">Zoom</span>
          <input type="range" min={1} max={20} step={0.5} value={zoom} style={{ width: 110 }} onChange={(e) => setZoom(Number(e.target.value))} />
        </div>
      </div>
      <div className="timeline-scroll" ref={scrollRef} onScroll={(e) => setView((v) => ({ ...v, scroll: (e.target as HTMLDivElement).scrollLeft }))}>
        <div style={{ width: fullWidth, height: 1 }} />
        <canvas
          ref={canvasRef}
          style={{ position: 'sticky', left: 0, top: 0, marginTop: -1 }}
          onMouseMove={(e) => setHoverCut(hitCut(e.clientX, e.clientY))}
          onMouseLeave={() => setHoverCut(null)}
          onClick={(e) => {
            const id = hitCut(e.clientX, e.clientY)
            if (id) return onToggleCut(id)
            const r = canvasRef.current!.getBoundingClientRect()
            onSeek(Math.max(0, Math.min(duration, (e.clientX - r.left + view.scroll - 10) / pps)))
          }}
        />
      </div>
    </div>
  )
}
