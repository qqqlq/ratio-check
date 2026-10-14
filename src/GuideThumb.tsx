import { useEffect, useRef } from 'react'
import { drawGen } from './guides'
import type { CatalogItem } from './guides'

/** ライブラリ用サムネイル。PNGは<img>、生成ガイドは小さなcanvasで描画 */
export default function GuideThumb({ item }: { item: CatalogItem }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (item.source.kind !== 'gen') return
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 2
    const ratio = item.ratio ?? 1.5
    const w = Math.min(cv.width - 8, (cv.height - 8) * ratio)
    const h = w / ratio
    drawGen(ctx, item.source.type, (cv.width - w) / 2, (cv.height - h) / 2, w, h)
  }, [item])
  if (item.source.kind === 'png') return <img src={item.source.url} alt={item.name} loading="lazy" />
  return <canvas ref={ref} width={160} height={100} />
}
