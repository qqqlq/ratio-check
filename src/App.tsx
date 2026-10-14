import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GuideThumb from './GuideThumb'
import Stage from './Stage'
import { uid } from './uid'
import { GEN_GUIDES, PNG_GUIDES } from './guides'
import type { CatalogItem } from './guides'
import { drawScene, loadImage } from './render'
import type { Anno, Doc, GuideLayer, PhotoFilter, Selection, Tool } from './types'

const EMPTY: Doc = { layers: [], annos: [] }
const DEFAULT_SIZE = { w: 1600, h: 1000 }

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: '選択', key: 'V' },
  { id: 'hand', label: '移動', key: 'H' },
  { id: 'note', label: 'メモ', key: 'T' },
  { id: 'ellipse', label: '円', key: 'O' },
  { id: 'rect', label: '四角', key: 'R' },
  { id: 'arrow', label: '矢印', key: 'A' },
  { id: 'line', label: '線', key: 'L' },
]

export default function App() {
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null)
  const [photoName, setPhotoName] = useState('photo')
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [filter, setFilter] = useState<PhotoFilter>({ gray: false, brightness: 1 })
  const [doc, setDoc] = useState<Doc>(EMPTY)
  const [selection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [tick, setTick] = useState(0)
  const [annoStyle, setAnnoStyle] = useState({ color: '#ff3b30', lineWidth: 6, size: 48 })
  const [exp, setExp] = useState({ format: 'png' as 'png' | 'jpeg', withPhoto: true })
  const [msg, setMsg] = useState('')
  const [dropping, setDropping] = useState(false)

  // ---- Undo/Redo ----
  const undo = useRef<Doc[]>([])
  const redo = useRef<Doc[]>([])
  const docRef = useRef(doc)
  docRef.current = doc
  const lastRecord = useRef({ t: 0, key: '' })

  const record = useCallback((key = '') => {
    const now = Date.now()
    if (key && lastRecord.current.key === key && now - lastRecord.current.t < 600) {
      lastRecord.current.t = now
      return
    }
    lastRecord.current = { t: now, key }
    undo.current.push(docRef.current)
    if (undo.current.length > 100) undo.current.shift()
    redo.current = []
  }, [])

  const doUndo = useCallback(() => {
    const prev = undo.current.pop()
    if (!prev) return
    redo.current.push(docRef.current)
    setDoc(prev)
    setSelection(null)
  }, [])
  const doRedo = useCallback(() => {
    const next = redo.current.pop()
    if (!next) return
    undo.current.push(docRef.current)
    setDoc(next)
    setSelection(null)
  }, [])

  /** パネルからの変更（連続操作はkey単位でUndoをまとめる） */
  const edit = useCallback(
    (fn: (d: Doc) => Doc, key = '') => {
      record(key)
      setDoc(fn)
    },
    [record],
  )

  // ---- 写真の読み込み ----
  const openPhoto = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMsg('画像ファイルを選んでください')
      return
    }
    const url = URL.createObjectURL(file)
    try {
      const img = await loadImage(url)
      setPhoto(img)
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      setPhotoName(file.name.replace(/\.[^.]+$/, ''))
      setMsg('')
    } catch {
      setMsg('画像を読み込めませんでした')
    }
  }, [])

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'))
      if (f) openPhoto(f)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [openPhoto])

  // ---- ガイド追加 ----
  const addGuide = useCallback(
    async (item: CatalogItem) => {
      if (item.source.kind === 'png') {
        try {
          await loadImage(item.source.url)
          setTick((t) => t + 1)
        } catch {
          setMsg('ガイド画像を読み込めませんでした')
          return
        }
      }
      // 比率を保ったまま写真に収まる最大サイズ。ratio=nullは写真全体に合わせる
      let w = size.w,
        h = size.h
      if (item.ratio) {
        if (size.w / size.h > item.ratio) {
          h = size.h
          w = h * item.ratio
        } else {
          w = size.w
          h = w / item.ratio
        }
      }
      const layer: GuideLayer = {
        id: uid(),
        name: item.name,
        source: item.source,
        cx: size.w / 2,
        cy: size.h / 2,
        w,
        h,
        rot: 0,
        flipX: false,
        flipY: false,
        opacity: 0.85,
        color: '#ffd400',
        lineWidth: Math.max(2, Math.round(Math.max(size.w, size.h) / 600)),
        visible: true,
        locked: false,
      }
      record()
      setDoc((d) => ({ ...d, layers: [...d.layers, layer] }))
      setSelection({ kind: 'layer', id: layer.id })
      setTool('select')
    },
    [size, record],
  )

  // ---- 削除・複製 ----
  const remove = useCallback(() => {
    if (!selection) return
    record()
    setDoc((d) => ({
      layers: d.layers.filter((l) => !(selection.kind === 'layer' && l.id === selection.id)),
      annos: d.annos.filter((a) => !(selection.kind === 'anno' && a.id === selection.id)),
    }))
    setSelection(null)
  }, [selection, record])

  const duplicate = useCallback(() => {
    if (!selection) return
    const off = Math.max(size.w, size.h) * 0.02
    const id = uid()
    record()
    if (selection.kind === 'layer') {
      setDoc((d) => {
        const src = d.layers.find((l) => l.id === selection.id)
        return src ? { ...d, layers: [...d.layers, { ...src, id, cx: src.cx + off, cy: src.cy + off }] } : d
      })
    } else {
      setDoc((d) => {
        const src = d.annos.find((a) => a.id === selection.id)
        return src
          ? { ...d, annos: [...d.annos, { ...src, id, x1: src.x1 + off, y1: src.y1 + off, x2: src.x2 + off, y2: src.y2 + off }] }
          : d
      })
    }
    setSelection({ kind: selection.kind, id })
  }, [selection, size, record])

  // ---- ショートカット ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'color') return
      if (t instanceof HTMLTextAreaElement) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? doRedo() : doUndo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        doRedo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicate()
        return
      }
      if (mod) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        remove()
        return
      }
      if (e.key === 'Escape') {
        setSelection(null)
        setTool('select')
        return
      }
      if (selection?.kind === 'layer' && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        edit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === selection.id ? { ...l, cx: l.cx + dx, cy: l.cy + dy } : l)) }), 'arrow')
        return
      }
      const hit = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (hit) setTool(hit.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doUndo, doRedo, duplicate, remove, selection, edit])

  // ---- 書き出し ----
  const exportImage = useCallback(async () => {
    const withPhoto = exp.withPhoto && !!photo
    const format = withPhoto || exp.format === 'png' ? exp.format : 'png'
    const cv = document.createElement('canvas')
    cv.width = size.w
    cv.height = size.h
    const ctx = cv.getContext('2d')!
    if (format === 'jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, cv.width, cv.height)
    }
    drawScene(ctx, withPhoto ? photo : null, size, filter, doc.layers, doc.annos)
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    cv.toBlob(
      (blob) => {
        if (!blob) {
          setMsg('書き出しに失敗しました（画像が大きすぎる可能性があります）')
          return
        }
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${photoName}_ratio.${format === 'jpeg' ? 'jpg' : 'png'}`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
        setMsg('')
      },
      mime,
      0.95,
    )
  }, [exp, photo, size, filter, doc, photoName])

  const selLayer = useMemo(
    () => (selection?.kind === 'layer' ? doc.layers.find((l) => l.id === selection.id) : undefined),
    [selection, doc],
  )
  const selAnno = useMemo(
    () => (selection?.kind === 'anno' ? doc.annos.find((a) => a.id === selection.id) : undefined),
    [selection, doc],
  )

  const patchLayer = (patch: Partial<GuideLayer>, key: string) =>
    selLayer && edit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === selLayer.id ? { ...l, ...patch } : l)) }), key)
  const patchAnno = (patch: Partial<Anno>, key: string) => {
    if (selAnno) edit((d) => ({ ...d, annos: d.annos.map((a) => (a.id === selAnno.id ? { ...a, ...patch } : a)) }), key)
    setAnnoStyle((s) => ({
      color: patch.color ?? s.color,
      lineWidth: patch.lineWidth ?? s.lineWidth,
      size: patch.size ?? s.size,
    }))
  }

  const moveLayer = (id: string, dir: -1 | 1) =>
    edit((d) => {
      const i = d.layers.findIndex((l) => l.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= d.layers.length) return d
      const layers = d.layers.slice()
      ;[layers[i], layers[j]] = [layers[j], layers[i]]
      return { ...d, layers }
    })

  const fitToPhoto = () => selLayer && patchLayer({ cx: size.w / 2, cy: size.h / 2, w: size.w, h: size.h, rot: 0 }, '')

  return (
    <div
      className={'app' + (dropping ? ' dropping' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const f = e.dataTransfer.files[0]
        if (f) openPhoto(f)
      }}
    >
      <header className="topbar">
        <h1>RatioCheck</h1>
        <label className="btn primary">
          写真を開く
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && openPhoto(e.target.files[0])} />
        </label>
        <div className="tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button onClick={doUndo} title="元に戻す (Ctrl+Z)">↶</button>
        <button onClick={doRedo} title="やり直し (Ctrl+Shift+Z)">↷</button>
        <select value={exp.format} onChange={(e) => setExp({ ...exp, format: e.target.value as 'png' | 'jpeg' })}>
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </select>
        <label className="chk">
          <input type="checkbox" checked={exp.withPhoto} onChange={(e) => setExp({ ...exp, withPhoto: e.target.checked })} />
          写真を含める
        </label>
        <button className="btn primary" onClick={exportImage}>ダウンロード</button>
      </header>

      <aside className="library">
        <h2>写真の表示</h2>
        <label className="chk">
          <input type="checkbox" checked={filter.gray} onChange={(e) => setFilter({ ...filter, gray: e.target.checked })} />
          モノクロ
        </label>
        <label className="row">
          明るさ
          <input
            type="range"
            min={0.2}
            max={1.2}
            step={0.05}
            value={filter.brightness}
            onChange={(e) => setFilter({ ...filter, brightness: +e.target.value })}
          />
        </label>
        <h2>ガイド（クリックで追加）</h2>
        <div className="thumbs">
          {[...GEN_GUIDES, ...PNG_GUIDES].map((it) => (
            <button key={it.id} className="thumb" onClick={() => addGuide(it)} title={it.name}>
              <GuideThumb item={it} />
              <span>{it.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {!photo && (
          <div className="empty">
            写真をドラッグ＆ドロップ／貼り付け／「写真を開く」<br />
            <small>写真なしでもガイドを置いて確認できます</small>
          </div>
        )}
        <Stage
          photo={photo}
          size={size}
          filter={filter}
          doc={doc}
          tool={tool}
          selection={selection}
          annoStyle={annoStyle}
          tick={tick}
          onSelect={setSelection}
          onBeginEdit={() => record()}
          onChangeDoc={(fn) => setDoc(fn)}
          onCreateAnno={(a) => {
            setDoc((d) => ({ ...d, annos: [...d.annos, a] }))
            setSelection({ kind: 'anno', id: a.id })
          }}
          onToolDone={() => setTool('select')}
        />
        {msg && <div className="toast">{msg}</div>}
      </main>

      <aside className="inspector">
        <h2>レイヤー</h2>
        <ul className="layers">
          {[...doc.layers].reverse().map((l) => (
            <li key={l.id} className={selection?.id === l.id ? 'sel' : ''} onClick={() => setSelection({ kind: 'layer', id: l.id })}>
              <button
                className="ic"
                title="表示切替"
                onClick={(e) => {
                  e.stopPropagation()
                  edit((d) => ({ ...d, layers: d.layers.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)) }))
                }}
              >
                {l.visible ? '👁' : '–'}
              </button>
              <span className="nm">{l.name}</span>
              <button className="ic" title="手前へ" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, 1))}>▲</button>
              <button className="ic" title="奥へ" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, -1))}>▼</button>
            </li>
          ))}
          {!doc.layers.length && <li className="hint">左のライブラリからガイドを追加</li>}
        </ul>

        {selLayer && (
          <section>
            <h2>ガイドの設定</h2>
            <label className="row">不透明度
              <input type="range" min={0.05} max={1} step={0.05} value={selLayer.opacity} onChange={(e) => patchLayer({ opacity: +e.target.value }, 'op')} />
            </label>
            <label className="row">線の色
              <input type="color" value={selLayer.color} onChange={(e) => patchLayer({ color: e.target.value }, 'color')} />
            </label>
            {selLayer.source.kind === 'gen' && (
              <label className="row">線の太さ
                <input type="range" min={1} max={Math.max(20, Math.round(size.w / 150))} step={1} value={selLayer.lineWidth} onChange={(e) => patchLayer({ lineWidth: +e.target.value }, 'lw')} />
              </label>
            )}
            <label className="row">回転 (°)
              <input type="number" step={1} value={Math.round(selLayer.rot * 10) / 10} onChange={(e) => patchLayer({ rot: +e.target.value || 0 }, 'rot')} />
            </label>
            <div className="btns">
              <button onClick={() => patchLayer({ rot: ((selLayer.rot + 90 + 180) % 360) - 180 }, '')}>90°回転</button>
              <button onClick={() => patchLayer({ flipX: !selLayer.flipX }, '')}>左右反転</button>
              <button onClick={() => patchLayer({ flipY: !selLayer.flipY }, '')}>上下反転</button>
              <button onClick={fitToPhoto}>写真に合わせる</button>
              <button onClick={() => patchLayer({ locked: !selLayer.locked }, '')}>{selLayer.locked ? 'ロック解除' : 'ロック'}</button>
              <button onClick={duplicate}>複製</button>
              <button className="danger" onClick={remove}>削除</button>
            </div>
            <p className="hint">ドラッグで移動／角で拡縮（Shiftで自由変形）／上の○で回転（Shiftで15°刻み）／矢印キーで微調整</p>
          </section>
        )}

        <section>
          <h2>注釈{selAnno ? 'の設定' : '（ツールで追加）'}</h2>
          {selAnno?.type === 'note' && (
            <textarea rows={3} value={selAnno.text} onChange={(e) => patchAnno({ text: e.target.value }, 'text')} />
          )}
          <label className="row">色
            <input type="color" value={selAnno?.color ?? annoStyle.color} onChange={(e) => patchAnno({ color: e.target.value }, 'acolor')} />
          </label>
          {selAnno?.type === 'note' || (!selAnno && tool === 'note') ? (
            <label className="row">文字サイズ
              <input type="range" min={12} max={Math.max(120, Math.round(size.w / 15))} value={selAnno?.size ?? annoStyle.size} onChange={(e) => patchAnno({ size: +e.target.value }, 'asize')} />
            </label>
          ) : (
            <label className="row">線の太さ
              <input type="range" min={1} max={Math.max(24, Math.round(size.w / 100))} value={selAnno?.lineWidth ?? annoStyle.lineWidth} onChange={(e) => patchAnno({ lineWidth: +e.target.value }, 'alw')} />
            </label>
          )}
          {selAnno && (
            <div className="btns">
              <button onClick={duplicate}>複製</button>
              <button className="danger" onClick={remove}>削除</button>
            </div>
          )}
        </section>
        <p className="hint">ホイールでズーム／Spaceまたは「移動」でパン</p>
      </aside>
    </div>
  )
}
