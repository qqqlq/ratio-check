import { drawGen } from './guides'
import type { Anno, GuideLayer, PhotoFilter } from './types'

// ---- 画像キャッシュ（PNGガイドの読み込みと着色） ----
const images = new Map<string, HTMLImageElement>()

export function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = images.get(url)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      images.set(url, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(`画像を読み込めません: ${url}`))
    img.src = url
  })
}

const tintCache = new Map<string, HTMLCanvasElement>()
const TINT_LIMIT = 6

function tinted(url: string, color: string): HTMLCanvasElement | null {
  const img = images.get(url)
  if (!img) return null
  const key = `${url}|${color}`
  const hit = tintCache.get(key)
  if (hit) {
    tintCache.delete(key)
    tintCache.set(key, hit) // LRU更新
    return hit
  }
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  tintCache.set(key, c)
  while (tintCache.size > TINT_LIMIT) tintCache.delete(tintCache.keys().next().value!)
  return c
}

// ---- シーン描画（画面表示と書き出しで共通） ----
export function drawLayer(ctx: CanvasRenderingContext2D, l: GuideLayer) {
  ctx.save()
  ctx.translate(l.cx, l.cy)
  ctx.rotate((l.rot * Math.PI) / 180)
  ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1)
  ctx.globalAlpha = l.opacity
  if (l.source.kind === 'png') {
    const t = tinted(l.source.url, l.color)
    if (t) {
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(t, -l.w / 2, -l.h / 2, l.w, l.h)
    }
  } else {
    ctx.strokeStyle = l.color
    ctx.lineWidth = l.lineWidth
    ctx.lineJoin = 'round'
    drawGen(ctx, l.source.type, -l.w / 2, -l.h / 2, l.w, l.h)
  }
  ctx.restore()
}

export function drawAnno(ctx: CanvasRenderingContext2D, a: Anno) {
  ctx.save()
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = a.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const { x1, y1, x2, y2 } = a
  if (a.type === 'note') {
    ctx.font = `600 ${a.size}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`
    ctx.textBaseline = 'top'
    const lines = a.text.split('\n')
    const lh = a.size * 1.35
    const wMax = Math.max(...lines.map((s) => ctx.measureText(s).width))
    const pad = a.size * 0.4
    ctx.globalAlpha = 0.78
    ctx.fillStyle = '#111'
    ctx.fillRect(x1 - pad, y1 - pad, wMax + pad * 2, lh * lines.length + pad * 2 - (lh - a.size))
    ctx.globalAlpha = 1
    ctx.fillStyle = a.color
    lines.forEach((s, i) => ctx.fillText(s, x1, y1 + i * lh))
  } else if (a.type === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (a.type === 'rect') {
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
  } else {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    if (a.type === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1)
      const hl = Math.max(a.lineWidth * 5, 16)
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - hl * Math.cos(ang - 0.4), y2 - hl * Math.sin(ang - 0.4))
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - hl * Math.cos(ang + 0.4), y2 - hl * Math.sin(ang + 0.4))
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function noteBounds(ctx: CanvasRenderingContext2D, a: Anno) {
  ctx.save()
  ctx.font = `600 ${a.size}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`
  const lines = a.text.split('\n')
  const wMax = Math.max(...lines.map((s) => ctx.measureText(s).width))
  ctx.restore()
  const pad = a.size * 0.4
  const h = a.size * 1.35 * lines.length + pad * 2 - (a.size * 1.35 - a.size)
  return { x: a.x1 - pad, y: a.y1 - pad, w: wMax + pad * 2, h }
}

/** 写真・ガイド・注釈を現在のctx座標系（画像座標）へ描画 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement | null,
  size: { w: number; h: number },
  filter: PhotoFilter,
  layers: GuideLayer[],
  annos: Anno[],
) {
  if (photo) {
    ctx.save()
    ctx.filter = `${filter.gray ? 'grayscale(1) ' : ''}brightness(${filter.brightness})`
    ctx.drawImage(photo, 0, 0, size.w, size.h)
    ctx.restore()
  }
  for (const l of layers) if (l.visible) drawLayer(ctx, l)
  for (const a of annos) drawAnno(ctx, a)
}
