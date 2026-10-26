import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  blockEnd,
  blockStart,
  cropRect,
  cutAt,
  displayWord,
  keepSegments,
  OUTPUT_SIZES,
  outputDuration,
  sourceToOutput,
  type CaptionBlock,
  type CaptionPreset,
  type Project
} from '../../engine'
import { formatTime } from '../api'
import { Icon } from './ui'

export interface PreviewHandle {
  seek(t: number): void
  toggle(): void
  pause(): void
}

interface Props {
  project: Project
  preset: CaptionPreset
  proxyUrl: string
  onTime: (t: number) => void
  onExactFrame: (t: number) => void
}

const BRIDGE = 0.3

/** Untertitel-Block, der zur Quellzeit t angezeigt wird (inkl. Überbrückung kleiner Lücken). */
function blockAt(blocks: CaptionBlock[], t: number): CaptionBlock | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (!b.words.length) continue
    const next = blocks[i + 1]
    let end = blockEnd(b)
    if (next && next.words.length && blockStart(next) - end < BRIDGE) end = blockStart(next)
    if (t >= blockStart(b) && t < end) return b
  }
  return null
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ project, preset, proxyUrl, onTime, onExactFrame }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const media = project.media!
  const out = OUTPUT_SIZES[project.format.aspect]

  const segments = useMemo(() => keepSegments(media.duration, project.cuts), [media.duration, project.cuts])
  const outDur = useMemo(() => outputDuration(segments), [segments])
  const cutsRef = useRef(project.cuts)
  cutsRef.current = project.cuts

  // Rahmen in den verfügbaren Platz einpassen
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth - 36
      const ch = el.clientHeight - 36
      const a = out.width / out.height
      const w = Math.min(cw, ch * a)
      setBox({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(w / a)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [out.width, out.height])

  // Wiedergabe-Schleife: Schnitte überspringen, Zeit melden, Blur-Hintergrund zeichnen
  useEffect(() => {
    let raf = 0
    let lastTime = -1
    const tick = (): void => {
      const v = videoRef.current
      if (v) {
        const cut = cutAt(cutsRef.current, v.currentTime)
        if (cut && !v.paused) v.currentTime = Math.min(media.duration, cut.end)
        if (v.currentTime !== lastTime) {
          lastTime = v.currentTime
          setTime(v.currentTime)
          onTime(v.currentTime)
        }
        const c = canvasRef.current
        if (c && v.readyState >= 2) {
          const ctx = c.getContext('2d')
          if (ctx) {
            const s = Math.max(c.width / v.videoWidth, c.height / v.videoHeight)
            const w = v.videoWidth * s
            const h = v.videoHeight * s
            ctx.filter = 'blur(14px) brightness(0.9)'
            ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [media.duration, onTime])

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(media.duration - 0.01, t))
    },
    [media.duration]
  )

  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime >= media.duration - 0.05) v.currentTime = 0
      void v.play()
    } else v.pause()
  }, [media.duration])

  useImperativeHandle(ref, () => ({ seek, toggle, pause: () => videoRef.current?.pause() }), [seek, toggle])

  // Ausschnitt / Einpassung im Vorschau-Rahmen
  const scale = box.w / out.width
  let videoStyle: CSSProperties
  if (project.format.mode === 'fill') {
    const c = cropRect(media.width, media.height, project.format.aspect, project.format.zoom, project.format.offsetX, project.format.offsetY)
    const s = box.w / c.w
    videoStyle = { width: media.width * s, height: media.height * s, left: -c.x * s, top: -c.y * s }
  } else {
    const s = Math.min(box.w / media.width, box.h / media.height) * Math.max(1, project.format.zoom)
    const w = media.width * s
    const h = media.height * s
    videoStyle = { width: w, height: h, left: (box.w - w) / 2, top: (box.h - h) / 2 }
  }

  // Untertitel + Hook
  const outTime = sourceToOutput(segments, time)
  const inCut = !!cutAt(project.cuts, time)
  const block = project.captionsEnabled && !inCut ? blockAt(project.captions, time) : null
  const assScale = Math.min(out.width, out.height) / 1080
  const px = (v: number): number => v * assScale * scale
  const activeIndex = block ? block.words.findIndex((w, i) => time >= w.start && (i === block.words.length - 1 || time < block.words[i + 1].start)) : -1
  const hk = preset.hook
  const showHook = project.hook.enabled && project.hook.text.trim() !== '' && outTime < project.hook.durationSec

  return (
    <>
      <div className="preview-wrap" ref={wrapRef}>
        <div className="frame" style={{ width: box.w, height: box.h }} onDoubleClick={() => onExactFrame(time)}>
          {project.format.mode === 'blur' && <canvas className="bg" ref={canvasRef} width={160} height={Math.round((160 * out.height) / out.width)} />}
          <video
            className="main"
            ref={videoRef}
            src={proxyUrl}
            style={videoStyle}
            preload="auto"
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <div className="overlay">
            {block && (
              <div
                key={block.id}
                className={`caption-live ${preset.animation === 'pop' ? 'pop' : ''}`}
                style={{
                  top: `${preset.positionY * 100}%`,
                  fontFamily: `'${preset.fontFamily}'`,
                  fontSize: px(preset.fontSize),
                  color: preset.textColor,
                  WebkitTextStroke: `${px(preset.outlineWidth) * 2}px ${preset.outlineColor}`,
                  textShadow: preset.shadow ? `${px(preset.shadow)}px ${px(preset.shadow)}px 0 rgba(0,0,0,0.6)` : 'none'
                }}
              >
                {block.words.map((w, i) => {
                  const color = i === activeIndex && preset.activeWordColor ? preset.activeWordColor : w.keyword ? preset.keywordColor : undefined
                  return (
                    <span key={i} style={color ? { color } : undefined}>
                      {displayWord(w.text, preset.uppercase)}
                      {i < block.words.length - 1 ? ' ' : ''}
                    </span>
                  )
                })}
              </div>
            )}
            {showHook && (
              <div
                className="hook-live"
                style={{ top: `${hk.positionY * 100}%`, fontFamily: `'${hk.fontFamily}'`, fontSize: px(hk.fontSize), color: hk.textColor }}
              >
                <span style={{ background: hk.barColor, padding: `${px(16) * 0.6}px ${px(16)}px` }}>
                  {hk.uppercase ? project.hook.text.toLocaleUpperCase('de-DE') : project.hook.text}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="transport">
        <button className="btn ghost small" onClick={() => seek(0)} title="Zum Anfang">
          ⏮
        </button>
        <button className="play-btn" onClick={toggle} title="Abspielen/Pause (Leertaste)">
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <div className="time">
          <b>{formatTime(outTime, true)}</b> / {formatTime(outDur, true)}
          <div className="label" style={{ marginTop: 3 }}>
            Quelle {formatTime(time, true)}
          </div>
        </div>
        <button className="btn small" onClick={() => onExactFrame(time)} title="Bild exakt wie im Export rendern (FFmpeg)">
          <Icon name="image" size={14} /> Exakte Vorschau
        </button>
      </div>
    </>
  )
})
