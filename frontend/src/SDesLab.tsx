import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Copy, LockKeyhole, UnlockKeyhole } from 'lucide-react'
import { api, ApiError } from './api'

interface Result {
  result: string
  operation: 'encrypt' | 'decrypt'
  byte_count: number
  schedule: { key: string; p10: string; ls1: string; k1: string; ls2: string; k2: string }
  block: { input: string; ip: string; first: string; swap: string; second: string; output: string }
}

function Stages({ rows }: { rows: string[][] }) {
  return <div className="table-scroll"><table className="cipher-table">
    <thead><tr><th>Етап</th><th>Біти</th></tr></thead>
    <tbody>{rows.map(([name, bits]) => <tr key={name}><th scope="row">{name}</th><td><code>{bits}</code></td></tr>)}</tbody>
  </table></div>
}

export default function SDesLab({ token, logout, algorithmChoice }: {
  token: string; logout: (reason?: string) => void; algorithmChoice: ReactNode
}) {
  const [key, setKey] = useState('1010000010')
  const [text, setText] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  function reset() { setResult(null); setNotice(''); setError('') }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    reset()
    const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const operation = button?.value === 'decrypt' ? 'decrypt' : 'encrypt'
    if (key.length !== 10 || /[^01]/.test(key)) {
      setError('Ключ має містити рівно 10 бітів (0 або 1).')
      return
    }
    if (!text) {
      setError(operation === 'encrypt' ? 'Введіть відкритий текст.' : 'Введіть шифротекст у HEX.')
      return
    }
    setBusy(true)
    try {
      setResult(await api<Result>(`/crypto/text/${operation}`, token, { algorithm: 'sdes', key, text }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout('Сесію завершено. Увійдіть повторно.')
      else setError(e instanceof Error ? e.message : 'Помилка обробки запиту.')
    } finally { setBusy(false) }
  }
  async function copy() {
    if (!result) return
    try { await navigator.clipboard.writeText(result.result); setNotice('Скопійовано.') }
    catch { setError('Не вдалося скопіювати. Виділіть результат вручну.') }
  }
  const schedule = result?.schedule
  const block = result?.block
  const encrypted = result?.operation === 'encrypt'
  return <div className="crypto-lab">
    <section className="profile-card"><form className="crypto-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="crypto-controls">{algorithmChoice}
        <label>Ключ (10 бітів)<input className="cipher-key" value={key} autoComplete="off" spellCheck={false}
          onChange={e => { setKey(e.target.value); reset() }} /></label>
      </div>
      <p className="file-instructions">S-DES — навчальний алгоритм. Він не призначений для реального захисту даних.</p>
      <label className="console-input"><span className="console-caption">Відкритий текст або шифротекст у HEX</span>
        <textarea rows={6} value={text} maxLength={80000} onChange={e => { setText(e.target.value); reset() }}
          placeholder="До 10 000 символів для шифрування або пари HEX-цифр без пробілів для розшифрування" />
      </label>
      <div className="section-heading">
        <button className="primary-button" value="encrypt"><LockKeyhole size={16} />Зашифрувати</button>
        <button className="primary-button" value="decrypt"><UnlockKeyhole size={16} />Розшифрувати</button>
      </div>
    </fieldset></form>
    {busy && <p role="status">Обробка…</p>}
    {error && <p role="alert" className="message error">{error}</p>}
    </section>
    {result && schedule && block && <>
      <section className="profile-card result-panel"><div className="section-heading">
        <h2>{encrypted ? 'Шифротекст у HEX' : 'Відновлений текст'}</h2>
        <button className="primary-button" onClick={copy}><Copy size={15} />Копіювати</button>
      </div><pre className="crypto-output">{result.result}</pre>{notice && <p role="status">{notice}</p>}</section>
      <section className="profile-card"><h2>Покрокова демонстрація · {encrypted ? 'Шифрування' : 'Розшифрування'}</h2>
        <details className="crypto-step" open><summary>Формування підключів</summary>
          <Stages rows={[[ 'Початковий ключ', schedule.key ], ['P10', schedule.p10], ['LS-1', schedule.ls1],
            ['P8 → K1', schedule.k1], ['LS-2', schedule.ls2], ['P8 → K2', schedule.k2]]} />
        </details>
        <details className="crypto-step" open><summary>Блок 1 із {result.byte_count} (8 бітів)</summary>
          <Stages rows={[[ 'Початковий блок', block.input ], ['IP', block.ip], [`Раунд 1 · fk(${encrypted ? 'K1' : 'K2'})`, block.first],
            ['Обмін половин · SW', block.swap], [`Раунд 2 · fk(${encrypted ? 'K2' : 'K1'})`, block.second],
            [encrypted ? 'IP⁻¹ · зашифрований блок' : 'IP⁻¹ · відновлений блок', block.output]]} />
        </details>
      </section>
    </>}
  </div>
}
