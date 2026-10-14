import { useCallback, useEffect, useRef, useState } from 'react'
import { drawScene, noteBounds } from './render'
import { uid } from './uid'
import type { Anno, AnnoType, Doc, GuideLayer, PhotoFilter, Selection, Tool } from './types'

interface View {
  scale: number
  ox: number
  oy: number
}

interface Props {
  photo: HTMLImageElement | null
  size: { w: number; h: number }
  filter: PhotoFilter
  doc: Doc
  tool: Tool
  selection: Selection
  annoStyle: { color: string; lineWidth: number; size: number }
  tick: number // PNG読み込み完了時の再描画用
  onSelect: (s: Selection) => void
  onBeginEdit: () => void
  onChangeDoc: (fn: (d: Doc) => Doc) => void
  onCreateAnno: (a: Anno) => void
  onToolDone: () => void
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'move-layer'; id: string; px: number; py: number; cx: number; cy: number }
  | { kind: 'move-anno'; id: string; px: number; py: number; orig: Anno }
  | { kind: 'anno-point'; id: string; which: 1 | 2 }
  | { kind: 'create'; id: string }
  | { kind: 'rotate'; id: string }
  | { kind: 'resize'; id: string; hx: number; hy: number }

const HANDLE = 6 // 画面px
const ROT_DIST = 28

const rad = (d: number) => (d * Math.PI) / 180

function toLocal(l: GuideLayer, x: number, y: number) {
  const r = rad(-l.rot)
  const dx = x - l.cx,
    dy = y - l.cy
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) }
}
function toWorld(l: GuideLayer, x: number, y: number) {
  const r = rad(l.rot)
  return { x: l.cx + x * Math.cos(r) - y * Math.sin(r), y: l.cy + x * Math.sin(r) + y * Math.cos(r) }
}

function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1,
    dy = y2 - y1
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2))
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))
}

export default function Stage(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 })
  const [box, setBox] = useState({ w: 800, h: 600 })
  const drag = useRef<Drag | null>(null)
  const spaceDown = useRef(false)
  const measureCtx = useRef<CanvasRenderingContext2D | null>(null)

  const fit = useCallback(() => {
    const m = 40
    const s = Math.min((box.w - m * 2) / p.size.w, (box.h - m * 2) / p.size.h)
    setView({ scale: s, ox: (box.w - p.size.w * s) / 2, oy: (box.h - p.size.h * s) / 2 })
  }, [box, p.size.w, p.size.h])

  // 写真が変わった／ウィンドウサイズが変わったらフィット
  const fitKey = `${p.size.w}x${p.size.h}`
  const lastFit = useRef('')
  useEffect(() => {
    if (lastFit.current !== fitKey) {
      lastFit.current = fitKey
      fit()
    }
  }, [fitKey, fit])

  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        spaceDown.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const screenToImg = (cx: number, cy: number) => ({ x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale })
  const evPos = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }

  const selLayer = p.selection?.kind === 'layer' ? p.doc.layers.find((l) => l.id === p.selection!.id) : undefined
  const selAnno = p.selection?.kind === 'anno' ? p.doc.annos.find((a) => a.id === p.selection!.id) : undefined

  // ---- 描画 ----
  useEffect(() => {
    const cv = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(box.w * dpr)
    cv.height = Math.round(box.h * dpr)
    const ctx = cv.getContext('2d')!
    measureCtx.current = ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy)
    // 写真領域の背景
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, p.size.w, p.size.h)
    drawScene(ctx, p.photo, p.size, p.filter, p.doc.layers, p.doc.annos)

    // 選択ハンドル（画面座標で描画）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#2f8cff'
    ctx.fillStyle = '#fff'
    const S = (x: number, y: number) => ({ x: x * view.scale + view.ox, y: y * view.scale + view.oy })
    const dot = (x: number, y: number) => {
      ctx.beginPath()
      ctx.rect(x - HANDLE / 2 - 1, y - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2)
      ctx.fill()
      ctx.stroke()
    }
    if (selLayer) {
      const l = selLayer
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy]) => S(...(Object.values(toWorld(l, (sx * l.w) / 2, (sy * l.h) / 2)) as [number, number])))
      ctx.beginPath()
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)))
      ctx.closePath()
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.setLineDash([])
      for (const [hx, hy] of HANDLES) {
        const w = toWorld(l, (hx * l.w) / 2, (hy * l.h) / 2)
        const s = S(w.x, w.y)
        dot(s.x, s.y)
      }
      const top = S(...(Object.values(toWorld(l, 0, -l.h / 2)) as [number, number]))
      const rp = rotHandlePos(l, view)
      ctx.beginPath()
      ctx.moveTo(top.x, top.y)
      ctx.lineTo(rp.x, rp.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(rp.x, rp.y, HANDLE, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    if (selAnno) {
      const a = selAnno
      if (a.type === 'note') {
        const b = noteBounds(ctx, a)
        const s = S(b.x, b.y)
        ctx.setLineDash([5, 4])
        ctx.strokeRect(s.x, s.y, b.w * view.scale, b.h * view.scale)
        ctx.setLineDash([])
      } else {
        const s1 = S(a.x1, a.y1),
          s2 = S(a.x2, a.y2)
        dot(s1.x, s1.y)
        dot(s2.x, s2.y)
      }
    }
  }, [p.photo, p.size, p.filter, p.doc, p.tick, view, box, selLayer, selAnno])

  // ---- ヒットテスト ----
  const hitHandle = (l: GuideLayer, sx: number, sy: number): Drag | null => {
    const rp = rotHandlePos(l, view)
    if (Math.hypot(sx - rp.x, sy - rp.y) <= HANDLE + 3) return { kind: 'rotate', id: l.id }
    for (const [hx, hy] of HANDLES) {
      const w = toWorld(l, (hx * l.w) / 2, (hy * l.h) / 2)
      const sxp = w.x * view.scale + view.ox,
        syp = w.y * view.scale + view.oy
      if (Math.abs(sx - sxp) <= HANDLE + 3 && Math.abs(sy - syp) <= HANDLE + 3) return { kind: 'resize', id: l.id, hx, hy }
    }
    return null
  }

  const hitAnno = (x: number, y: number): Anno | undefined => {
    const tol = 8 / view.scale
    for (let i = p.doc.annos.length - 1; i >= 0; i--) {
      const a = p.doc.annos[i]
      if (a.type === 'note') {
        const b = noteBounds(measureCtx.current!, a)
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return a
      } else if (a.type === 'rect') {
        const x0 = Math.min(a.x1, a.x2),
          x1 = Math.max(a.x1, a.x2),
          y0 = Math.min(a.y1, a.y2),
          y1 = Math.max(a.y1, a.y2)
        const inside = x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol
        const inner = x > x0 + tol && x < x1 - tol && y > y0 + tol && y < y1 - tol
        if (inside && !inner) return a
      } else if (a.type === 'ellipse') {
        const rx = Math.abs(a.x2 - a.x1) / 2 || 1,
          ry = Math.abs(a.y2 - a.y1) / 2 || 1
        const nx = (x - (a.x1 + a.x2) / 2) / rx,
          ny = (y - (a.y1 + a.y2) / 2) / ry
        if (Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= tol) return a
      } else if (distSeg(x, y, a.x1, a.y1, a.x2, a.y2) <= tol) return a
    }
  }

  const hitLayer = (x: number, y: number): GuideLayer | undefined => {
    for (let i = p.doc.layers.length - 1; i >= 0; i--) {
      const l = p.doc.layers[i]
      if (!l.visible || l.locked) continue
      const q = toLocal(l, x, y)
      if (Math.abs(q.x) <= l.w / 2 && Math.abs(q.y) <= l.h / 2) return l
    }
  }

  // ---- ポインタ操作 ----
  const onPointerDown = (e: React.PointerEvent) => {
    const { sx, sy } = evPos(e)
    const pt = screenToImg(sx, sy)
    canvasRef.current!.setPointerCapture(e.pointerId)

    if (e.button === 1 || p.tool === 'hand' || spaceDown.current) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy }
      return
    }
    if (p.tool !== 'select') {
      p.onBeginEdit()
      const id = uid()
      const type = p.tool as AnnoType
      const a: Anno = {
        id,
        type,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
        text: 'メモ',
        size: p.annoStyle.size,
        color: p.annoStyle.color,
        lineWidth: p.annoStyle.lineWidth,
      }
      p.onCreateAnno(a)
      if (type === 'note') p.onToolDone()
      else drag.current = { kind: 'create', id }
      return
    }

    // 選択中ガイドのハンドル
    if (selLayer && !selLayer.locked) {
      const h = hitHandle(selLayer, sx, sy)
      if (h) {
        p.onBeginEdit()
        drag.current = h
        return
      }
    }
    // 選択中注釈の端点
    if (selAnno && selAnno.type !== 'note') {
      for (const which of [1, 2] as const) {
        const ax = which === 1 ? selAnno.x1 : selAnno.x2,
          ay = which === 1 ? selAnno.y1 : selAnno.y2
        if (Math.hypot(sx - (ax * view.scale + view.ox), sy - (ay * view.scale + view.oy)) <= HANDLE + 3) {
          p.onBeginEdit()
          drag.current = { kind: 'anno-point', id: selAnno.id, which }
          return
        }
      }
    }
    const a = hitAnno(pt.x, pt.y)
    if (a) {
      p.onSelect({ kind: 'anno', id: a.id })
      p.onBeginEdit()
      drag.current = { kind: 'move-anno', id: a.id, px: pt.x, py: pt.y, orig: a }
      return
    }
    const l = hitLayer(pt.x, pt.y)
    if (l) {
      p.onSelect({ kind: 'layer', id: l.id })
      p.onBeginEdit()
      drag.current = { kind: 'move-layer', id: l.id, px: pt.x, py: pt.y, cx: l.cx, cy: l.cy }
      return
    }
    p.onSelect(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, ox: d.ox + e.clientX - d.sx, oy: d.oy + e.clientY - d.sy }))
      return
    }
    const { sx, sy } = evPos(e)
    const pt = screenToImg(sx, sy)
    const upd = (fn: (d: Doc) => Doc) => p.onChangeDoc(fn)
    const mapLayer = (id: string, fn: (l: GuideLayer) => GuideLayer) =>
      upd((doc) => ({ ...doc, layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)) }))
    const mapAnno = (id: string, fn: (a: Anno) => Anno) =>
      upd((doc) => ({ ...doc, annos: doc.annos.map((a) => (a.id === id ? fn(a) : a)) }))

    if (d.kind === 'move-layer') {
      mapLayer(d.id, (l) => ({ ...l, cx: d.cx + pt.x - d.px, cy: d.cy + pt.y - d.py }))
    } else if (d.kind === 'move-anno') {
      const dx = pt.x - d.px,
        dy = pt.y - d.py
      mapAnno(d.id, (a) => ({ ...a, x1: d.orig.x1 + dx, y1: d.orig.y1 + dy, x2: d.orig.x2 + dx, y2: d.orig.y2 + dy }))
    } else if (d.kind === 'create') {
      mapAnno(d.id, (a) => ({ ...a, x2: pt.x, y2: pt.y }))
    } else if (d.kind === 'anno-point') {
      mapAnno(d.id, (a) => (d.which === 1 ? { ...a, x1: pt.x, y1: pt.y } : { ...a, x2: pt.x, y2: pt.y }))
    } else if (d.kind === 'rotate') {
      mapLayer(d.id, (l) => {
        let deg = (Math.atan2(pt.y - l.cy, pt.x - l.cx) * 180) / Math.PI + 90
        if (e.shiftKey) deg = Math.round(deg / 15) * 15
        deg = ((deg % 360) + 540) % 360 - 180
        return { ...l, rot: Math.round(deg * 10) / 10 }
      })
    } else if (d.kind === 'resize') {
      mapLayer(d.id, (l) => resize(l, d.hx, d.hy, pt.x, pt.y, e.shiftKey))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) canvasRef.current.releasePointerCapture(e.pointerId)
    if (d?.kind === 'create') {
      // ほぼクリックだけだった図形は既定サイズにする
      p.onChangeDoc((doc) => ({
        ...doc,
        annos: doc.annos.map((a) => {
          if (a.id !== d.id) return a
          return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 6 / view.scale
            ? { ...a, x2: a.x1 + 160 / view.scale, y2: a.y1 + (a.type === 'line' || a.type === 'arrow' ? 0 : 100 / view.scale) }
            : a
        }),
      }))
      p.onToolDone()
    }
  }

  // wheel: Ctrl/⌘ or そのまま → ズーム（カーソル中心）
  useEffect(() => {
    const el = canvasRef.current!
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left,
        my = e.clientY - r.top
      const k = Math.exp(-e.deltaY * 0.0015)
      setView((v) => {
        const ns = Math.min(Math.max(v.scale * k, 0.02), 16)
        const f = ns / v.scale
        return { scale: ns, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const cursor =
    p.tool === 'hand' ? 'grab' : p.tool === 'select' ? 'default' : p.tool === 'note' ? 'text' : 'crosshair'

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: box.w, height: box.h, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="stage-hud">
        <button onClick={fit} title="全体を表示">全体表示</button>
        <button onClick={() => setView((v) => zoomAt(v, box, 1))} title="100%">100%</button>
        <span>{Math.round(view.scale * 100)}%</span>
      </div>
    </div>
  )
}

function zoomAt(v: View, box: { w: number; h: number }, target: number): View {
  const f = target / v.scale
  const mx = box.w / 2,
    my = box.h / 2
  return { scale: target, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f }
}

const HANDLES: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
]

function rotHandlePos(l: GuideLayer, v: View) {
  // 上辺中央から「画面上で」ROT_DIST離れた位置（回転方向に追従）
  const top = toWorld(l, 0, -l.h / 2)
  const r = rad(l.rot)
  return {
    x: top.x * v.scale + v.ox + Math.sin(r) * ROT_DIST,
    y: top.y * v.scale + v.oy - Math.cos(r) * ROT_DIST,
  }
}

/** ハンドルのドラッグでガイドを拡縮。反対側の辺/角を固定。角は縦横比維持（Shiftで自由変形） */
function resize(l: GuideLayer, hx: number, hy: number, px: number, py: number, free: boolean): GuideLayer {
  const q = toLocal(l, px, py)
  const MIN = 10
  const ax = -hx * (l.w / 2),
    ay = -hy * (l.h / 2) // 固定する点（ローカル座標）
  let w = l.w,
    h = l.h
  const corner = hx !== 0 && hy !== 0
  if (corner && !free) {
    const dx = q.x - ax,
      dy = q.y - ay
    const gx = hx * l.w,
      gy = hy * l.h
    const k = Math.max((dx * gx + dy * gy) / (gx * gx + gy * gy), MIN / Math.min(l.w, l.h))
    w = l.w * k
    h = l.h * k
  } else {
    if (hx !== 0) w = Math.max(Math.abs(q.x - ax), MIN)
    if (hy !== 0) h = Math.max(Math.abs(q.y - ay), MIN)
  }
  const nx = hx !== 0 ? ax + hx * (w / 2) : 0
  const ny = hy !== 0 ? ay + hy * (h / 2) : 0
  const c = toWorld(l, nx, ny)
  return { ...l, w, h, cx: c.x, cy: c.y }
}
