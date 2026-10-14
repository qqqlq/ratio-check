export type GenType =
  | 'thirds'
  | 'phi'
  | 'diagonals'
  | 'center'
  | 'triangle'
  | 'spiral'
  | 'rects'

export type GuideSource =
  | { kind: 'png'; url: string }
  | { kind: 'gen'; type: GenType }

export interface GuideLayer {
  id: string
  name: string
  source: GuideSource
  cx: number
  cy: number
  w: number
  h: number
  rot: number // deg
  flipX: boolean
  flipY: boolean
  opacity: number
  color: string
  lineWidth: number // 画像座標でのpx（genのみ有効）
  visible: boolean
  locked: boolean
}

export type AnnoType = 'note' | 'ellipse' | 'rect' | 'arrow' | 'line'

export interface Anno {
  id: string
  type: AnnoType
  x1: number
  y1: number
  x2: number
  y2: number
  text: string
  size: number // noteの文字サイズ（画像座標px）
  color: string
  lineWidth: number
}

export interface Doc {
  layers: GuideLayer[] // 配列の後ろほど手前
  annos: Anno[]
}

export interface PhotoFilter {
  gray: boolean
  brightness: number // 0.2 - 1.2
}

export type Selection = { kind: 'layer' | 'anno'; id: string } | null

export type Tool = 'select' | 'hand' | 'note' | 'ellipse' | 'rect' | 'arrow' | 'line'
