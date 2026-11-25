import DiffieHellmanLab from './DhWorkspace'
import SDesLab from './SDesLab'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './api'
import FilePicker from './FilePicker'
import LanguageSelector from './LanguageSelector'
import type { TextLanguage } from './LanguageSelector'
import { Check, Copy, LockKeyhole, UnlockKeyhole } from 'lucide-react'

const algorithms = [ ['caesar', 'Шифр Цезаря'], ['horizontal', 'Горизонтальна перестановка'], ['vertical', 'Вертикальна перестановка'], ['combined', 'Комбінована перестановка'] ]
const rules: Record<string, string> = {
  horizontal: 'Запис рядками шириною N. Ключ — ранги стовпців: 1324 → порядок 1, 3, 2, 4. У кожному рядку читаємо стовпці за зростанням рангу.',
  vertical: 'Запис рядками шириною N. Ключ — ранги стовпців: 1324 → порядок 1, 3, 2, 4. Читаємо кожен стовпець згори вниз за зростанням рангу.',
  combined: 'Спочатку горизонтальна перестановка, потім вертикальна з тим самим ключем. При розшифруванні — обернена вертикальна, потім обернена горизонтальна.',
}
interface Step {
  kind: string; inverse?: boolean; width?: number; columns?: number[]; ranks?: string[]; input?: string; output?: string; output_to_input?: number[]; length?: number
  alphabets?: { source: string; shifted: string; shift: number }[]
  characters?: { input: string; output: string; position: number }[]
}
interface Result { result: string; rule: string; steps: Step[]; length: number; truncated: boolean }
const symbol = (value: string) => value === ' ' ? '␠' : value === '\n' ? '↵' : value === '\r' ? '␍' : value === '\t' ? '⇥' : value

function Grid({ text, width, ranks, total }: { text: string; width: number; ranks: string[]; total: number }) {
  const chars = Array.from(text)
  return <div className="table-scroll"><table className="cipher-table"><caption>␠ пробіл · ↵ перенос · ⇥ табуляція · ∅ порожня клітинка · … поза прев’ю</caption><thead><tr><th>Рядок</th>{ranks.map((rank, i) => <th key={i}>Стовп. {i + 1}<small>ранг {rank}</small></th>)}</tr></thead><tbody>{Array.from({ length: Math.ceil(chars.length / width) }, (_, row) => <tr key={row}><th>{row + 1}</th>{ranks.map((_, col) => <td key={col} title={`Позиція ${row * width + col + 1}`}>{chars[row * width + col] === undefined ? row * width + col < total ? '…' : '∅' : symbol(chars[row * width + col])}</td>)}</tr>)}</tbody></table></div>
}

export default function CryptoLab({ token, files = false, logout }: { token: string; files?: boolean; logout: (reason?: string) => void }) {
  const [algorithm, setAlgorithm] = useState('caesar')
  const [operation, setOperation] = useState('encrypt')
  const [language, setLanguage] = useState<TextLanguage>('UA')
  const [key, setKey] = useState('3')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])
  const reset = () => { setDownload(null); setResult(null); setError(''); setNotice('') }
  async function submit(event: FormEvent) {
    event.preventDefault(); reset()
    if (algorithm === 'caesar' ? !/^[+-]?[0-9]{1,100}$/.test(key) : key.length < 2 || key.length > 9 || [...key].sort().join('') !== Array.from({ length: key.length }, (_, i) => String(i + 1)).join('')) {
      setError(algorithm === 'caesar' ? 'Введіть ціле число зсуву, до 100 цифр.' : 'Ключ має містити цифри 1…N рівно раз, 2 ≤ N ≤ 9. Наприклад: 1324.'); return
    }
    setBusy(true)
    try {
      if (!files) setResult(await api<Result>(`/crypto/text/${operation}`, token, { text, algorithm, key, language }))
      else {
        if (!file || !file.name.toLowerCase().endsWith('.txt')) throw new Error('Оберіть .txt файл.')
        if (file.size > (operation === 'encrypt' ? 1 : 8) * 1024 * 1024) throw new Error('Ліміт: 1 МіБ оригіналу або 8 МіБ зашифрованого контейнера.')
        const query = new URLSearchParams({ algorithm, key, filename: file.name, language })
        const response = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')}/api/crypto/files/${operation}?${query}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=utf-8' }, body: file, signal: AbortSignal.timeout(30000), cache: 'no-store',
        })
        if (!response.ok) { const data = await response.json().catch(() => null); throw new ApiError(response.status, typeof data?.detail === 'string' ? data.detail : 'Не вдалося обробити файл.') }
        const url = URL.createObjectURL(await response.blob())
        const link = document.createElement('a'); link.href = url; link.download = `digitalvault-${operation}.txt`; document.body.appendChild(link); link.click(); link.remove()
        setDownload({ url, name: `digitalvault-${operation}.txt` })
        setNotice('Готово. Результат передано для завантаження.')
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout('Сесію завершено. Увійдіть повторно.')
      else if (e instanceof TypeError) setError('Не вдалося з’єднатися із сервером. Спробуйте ще раз.')
      else if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) setError('Час очікування вичерпано. Спробуйте ще раз.')
      else setError(e instanceof Error ? e.message.replaceAll('MiB', 'МіБ') : 'Помилка обробки запиту.')
    } finally { setBusy(false) }
  }
  const algorithmChoice = <div className="algorithm-choice"><span className="field-title">Алгоритм</span><div className="algorithm-switch" role="group" aria-label="Алгоритм">{(files ? algorithms : [...algorithms, ['sdes', 'S-DES'], ['dh', 'Diffie–Hellman']]).map(([id, label]) => <button type="button" key={id} data-algorithm={id} aria-pressed={algorithm === id} onClick={() => { setAlgorithm(id); setKey(id === 'caesar' ? '3' : '1324'); reset() }}>{label}</button>)}</div></div>
  if (algorithm === 'dh') return <DiffieHellmanLab algorithmChoice={algorithmChoice} />
  if (algorithm === 'sdes') return <SDesLab token={token} logout={logout} algorithmChoice={algorithmChoice} />
  return <div className="crypto-lab"><section className="profile-card"><form className="crypto-form" onSubmit={submit}><fieldset disabled={busy}><div className="crypto-controls with-language">{algorithmChoice}<LanguageSelector value={language} onChange={value => { setLanguage(value); reset() }} /><label>Операція<select value={operation} onChange={e => { setOperation(e.target.value); reset() }}><option value="encrypt">Шифрування</option><option value="decrypt">Розшифрування</option></select></label><label>Ключ<input className="cipher-key" value={key} maxLength={101} onChange={e => { setKey(e.target.value); reset() }} required autoComplete="off" spellCheck={false} /></label></div>{algorithm !== 'caesar' && <details className="compact-details"><summary>Правила ключа</summary><p>{rules[algorithm]}</p></details>}{files ? <><FilePicker file={file} onChange={value => { setFile(value); reset() }} busy={busy} success={!!notice} limit={(operation === 'encrypt' ? 1 : 8) * 1024 * 1024} onError={message => { reset(); setError(message) }} /><p className="file-instructions">Для розшифрування виберіть отриманий .txt-файл, той самий алгоритм, мову та ключ. Неправильний ключ не виявляється автоматично.</p></> : <label className="console-input"><span className="console-caption"><span>Текст (до 10 000 символів)</span><span className="terminal-tag">INPUT</span></span><textarea value={text} onChange={e => { setText(e.target.value); reset() }} maxLength={10000} rows={6} placeholder="Введіть український або англійський текст…" /></label>}<button className="primary-button" disabled={busy}>{operation === 'encrypt' ? <LockKeyhole size={16} aria-hidden="true" /> : <UnlockKeyhole size={16} aria-hidden="true" />}{busy ? 'Обробка…' : files ? 'Виконати та завантажити' : operation === 'encrypt' ? 'Зашифрувати' : 'Розшифрувати'}</button></fieldset></form>{download && <a className="primary-button download-result" href={download.url} download={download.name}>Завантажити результат</a>}{error && <p role="alert" className="message error">{error}</p>}{notice && !files && <p role="status" className="message success">{notice}</p>}</section>
  {result && <><section className="profile-card result-panel"><div className="section-heading"><h2><span className="terminal-tag">OUTPUT</span> Результат · {result.length} символів</h2><button className="primary-button" onClick={async () => { try { await navigator.clipboard.writeText(result.result); setNotice('Скопійовано.') } catch { setError('Не вдалося скопіювати. Виділіть текст вручну.') } }}>{notice === 'Скопійовано.' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{notice === 'Скопійовано.' ? 'Скопійовано' : 'Копіювати'}</button></div><pre className="crypto-output">{result.result || '(порожній текст)'}</pre></section><section className="profile-card"><h2>Покрокова візуалізація</h2><div className="visualization-source"><span>Ключ: <strong>{key}</strong></span><pre className="crypto-output">{text || '(порожній текст)'}</pre></div>{result.truncated && <p className="message">Прев’ю: перші 120 символів. Результат вище — повний.</p>}{result.steps.map((step, index) => <details className="crypto-step" key={index} open={index === 0}><summary>Крок {index + 1} · {algorithms.find(([id]) => id === step.kind)?.[1]}{step.inverse ? ' · Розшифрування' : ''}</summary>{step.alphabets ? <>{step.alphabets.map(a => <div key={a.source} className="alphabet"><p>Алфавіт → зсув {a.shift}</p><code>{a.source}</code><code>{a.shifted}</code></div>)}<div className="character-map">{step.characters?.map(c => <span key={c.position} title={`Позиція ${c.position}`}>{symbol(c.input)} → {symbol(c.output)}</span>)}</div></> : <><p className="muted">Стовпці: {step.columns?.join(' → ')}</p><Grid text={step.input || ''} width={step.width!} ranks={step.ranks!} total={step.length!} /><p className="muted">{step.inverse ? 'Відновлення позицій' : 'Порядок читання'}</p><pre className="crypto-output">{step.output_to_input?.join(' → ') || 'Немає символів'}</pre>{index < result.steps.length - 1 && <><h4>Проміжний результат</h4><pre className="crypto-output">{step.output || '(порожній текст)'}</pre></>}</>}</details>)}</section></>}
  </div>
}
