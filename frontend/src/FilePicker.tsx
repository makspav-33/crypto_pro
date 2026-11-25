import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { CheckCircle2, FileText, LoaderCircle, UploadCloud, X } from 'lucide-react'

export default function FilePicker({ file, onChange, busy, success, limit, onError }: { file: File | null; onChange: (file: File | null) => void; busy: boolean; success: boolean; limit: number; onError: (error: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const select = (files: FileList | null) => {
    if (busy || !files?.length) return
    if (files.length !== 1) { onError('Оберіть один TXT-файл.'); return }
    const selected = files[0]
    if (!selected.name.toLowerCase().endsWith('.txt')) { onError('Дозволені лише .txt файли.'); return }
    if (selected.size > limit) { onError(`Файл перевищує ліміт ${limit / 1024 / 1024} МіБ.`); return }
    onChange(selected)
  }
  const drop = (event: DragEvent) => { event.preventDefault(); depth.current = 0; setDragging(false); select(event.dataTransfer.files) }
  return <div className="file-picker"><input ref={input} type="file" className="file-input-hidden" accept=".txt,text/plain" tabIndex={-1} aria-label="Вибрати TXT-файл" onChange={e => { select(e.target.files); e.target.value = '' }} disabled={busy} />
    <button type="button" className={`file-dropzone ${dragging ? 'dragging' : ''} ${busy ? 'processing' : ''} ${success ? 'complete' : ''}`} disabled={busy} onClick={() => input.current?.click()} onDragEnter={e => { e.preventDefault(); depth.current++; setDragging(true) }} onDragLeave={e => { e.preventDefault(); if (--depth.current <= 0) setDragging(false) }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy' }} onDrop={drop}>
      <span className="upload-icon">{busy ? <LoaderCircle className="file-spinner" size={34} /> : success ? <CheckCircle2 size={34} /> : <UploadCloud size={34} />}</span><strong>{busy ? 'Обробка файлу…' : success ? 'Готово до завантаження' : dragging ? 'Відпустіть TXT-файл тут' : 'Перетягніть TXT-файл або натисніть'}</strong><span>UTF-8 · до {limit / 1024 / 1024} МіБ</span>
    </button>{file && <div className="selected-file" key={`${file.name}-${file.size}-${file.lastModified}`}><FileText size={24} /><div><strong>{file.name}</strong><small>{file.size.toLocaleString('uk-UA')} байт · {(file.size / 1024).toFixed(1)} КіБ</small></div><button type="button" className="icon-button" disabled={busy} aria-label="Видалити вибраний файл" onClick={() => { onChange(null); if (input.current) input.current.value = '' }}><X size={18} /></button></div>}
    {busy && <p className="upload-state" role="status"><LoaderCircle className="file-spinner" size={16} /> Виконуємо операцію…</p>}{success && !busy && <p className="upload-state upload-success" role="status"><CheckCircle2 size={18} /> Результат передано для завантаження</p>}
  </div>
}
