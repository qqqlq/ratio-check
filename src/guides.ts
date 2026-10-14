import type { GenType, GuideSource } from './types'

export const PHI = (1 + Math.sqrt(5)) / 2

export interface CatalogItem {
  id: string
  name: string
  source: GuideSource
  /** 初期配置のアスペクト比（w/h）。nullなら写真に合わせる */
  ratio: number | null
}

const png = (id: string, name: string, file: string, ratio: number): CatalogItem => ({
  id,
  name,
  source: { kind: 'png', url: `${import.meta.env.BASE_URL}guides/${file}` },
  ratio,
})

export const PNG_GUIDES: CatalogItem[] = [
  ...Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return png(`golden-${n}`, `黄金比 ${n}`, `golden-${n}.png`, 4119 / 2548)
  }),
  png('silver', '白銀比', 'silver.png', 3599 / 2546),
]

const gen = (type: GenType, name: string, ratio: number | null): CatalogItem => ({
  id: `gen-${type}`,
  name,
  source: { kind: 'gen', type },
  ratio,
})

export const GEN_GUIDES: CatalogItem[] = [
  gen('thirds', '三分割', null),
  gen('phi', '黄金分割グリッド (1:0.618:1)', null),
  gen('diagonals', '対角線 (X)', null),
  gen('center', '中心十字', null),
  gen('triangle', '黄金三角形', null),
  gen('spiral', '黄金螺旋', PHI),
  gen('rects', '黄金長方形の分割', PHI),
]

type Ctx = CanvasRenderingContext2D

function seg(ctx: Ctx, x1: number, y1: number, x2: number, y2: number) {
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
}

/** 正方形を切り出していく再帰分割。時計回りに左→上→右→下の順 */
function eachSquare(
  x: number,
  y: number,
  w: number,
  h: number,
  fn: (sx: number, sy: number, s: number, step: number) => void,
) {
  for (let i = 0; i < 12; i++) {
    const c = i % 4
    const s = c % 2 === 0 ? h : w
    if (s < 2 || s > Math.max(w, h) + 0.5) break
    if (c === 0) {
      fn(x, y, s, 0)
      x += s
      w -= s
    } else if (c === 1) {
      fn(x, y, s, 1)
      y += s
      h -= s
    } else if (c === 2) {
      fn(x + w - s, y, s, 2)
      w -= s
    } else {
      fn(x, y + h - s, s, 3)
      h -= s
    }
    if (w < 2 || h < 2) break
  }
}

/** 指定ボックス (x,y,w,h) にガイドを描画。strokeStyle/lineWidthは呼び出し側で設定済み */
export function drawGen(ctx: Ctx, type: GenType, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  const a = 1 / (1 + PHI) // 0.382
  const b = PHI / (1 + PHI) // 0.618
  switch (type) {
    case 'thirds':
      for (const t of [1 / 3, 2 / 3]) {
        seg(ctx, x + w * t, y, x + w * t, y + h)
        seg(ctx, x, y + h * t, x + w, y + h * t)
      }
      break
    case 'phi':
      for (const t of [a, b]) {
        seg(ctx, x + w * t, y, x + w * t, y + h)
        seg(ctx, x, y + h * t, x + w, y + h * t)
      }
      break
    case 'diagonals':
      seg(ctx, x, y, x + w, y + h)
      seg(ctx, x + w, y, x, y + h)
      break
    case 'center':
      seg(ctx, x + w / 2, y, x + w / 2, y + h)
      seg(ctx, x, y + h / 2, x + w, y + h / 2)
      break
    case 'triangle': {
      // 対角線と、残り2頂点からその対角線への垂線
      const x1 = x,
        y1 = y + h,
        x2 = x + w,
        y2 = y
      seg(ctx, x1, y1, x2, y2)
      const dx = x2 - x1,
        dy = y2 - y1
      const len2 = dx * dx + dy * dy
      for (const [px, py] of [
        [x, y],
        [x + w, y + h],
      ]) {
        const t = ((px - x1) * dx + (py - y1) * dy) / len2
        seg(ctx, px, py, x1 + dx * t, y1 + dy * t)
      }
      break
    }
    case 'rects':
      eachSquare(x, y, w, h, (sx, sy, s) => ctx.rect(sx, sy, s, s))
      break
    case 'spiral':
      eachSquare(x, y, w, h, (sx, sy, s, step) => {
        const r = s
        let cx: number, cy: number, a0: number
        if (step === 0) [cx, cy, a0] = [sx + s, sy + s, Math.PI]
        else if (step === 1) [cx, cy, a0] = [sx, sy + s, Math.PI * 1.5]
        else if (step === 2) [cx, cy, a0] = [sx, sy, 0]
        else [cx, cy, a0] = [sx + s, sy, Math.PI / 2]
        ctx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r)
        ctx.arc(cx, cy, r, a0, a0 + Math.PI / 2)
      })
      break
  }
  ctx.stroke()
}
