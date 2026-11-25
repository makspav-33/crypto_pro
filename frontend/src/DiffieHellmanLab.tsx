import { useState } from 'react'
import type { ReactNode } from 'react'
import { generatePrivateKey, maxPrime, modPow, parameters, privateKey } from './diffieHellman'

const example = { p: '23', g: '5', a: '6', b: '15' }
type Exchange = { p: number; g: number; a: number; b: number; A: number; B: number }
type Secrets = { A: number; B: number }

export default function DiffieHellmanLab({ algorithmChoice }: { algorithmChoice: ReactNode }) {
  const [fields, setFields] = useState(example)
  const [exchange, setExchange] = useState<Exchange | null>(null)
  const [secrets, setSecrets] = useState<Secrets | null>(null)
  const [error, setError] = useState('')

  function invalidate() {
    setExchange(null)
    setSecrets(null)
    setError('')
  }

  function prepare(generate: boolean) {
    invalidate()
    try {
      const { p, g } = parameters(fields.p, fields.g)
      if (generate) {
        setFields({ ...fields, a: String(generatePrivateKey(p)), b: String(generatePrivateKey(p)) })
        return
      }
      const a = privateKey(fields.a, 'a', p)
      const b = privateKey(fields.b, 'b', p)
      setExchange({ p, g, a, b, A: modPow(g, a, p), B: modPow(g, b, p) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося підготувати ключі.')
    }
  }

  function computeSecrets() {
    if (!exchange) return
    const { A, B, a, b, p } = exchange
    setSecrets({ A: modPow(B, a, p), B: modPow(A, b, p) })
  }

  function field(name: keyof typeof example, label: string) {
    return <label>{label}<input name={name} className="cipher-key" inputMode="numeric" autoComplete="off"
      value={fields[name]} onChange={e => { invalidate(); setFields({ ...fields, [name]: e.target.value }) }} /></label>
  }

  return <div className="crypto-lab">
    <section className="profile-card crypto-form">
      {algorithmChoice}
      <h2>Спільні відкриті параметри</h2>
      <p className="file-instructions">Сторони домовляються про просте число p та генератор g. Малі параметри призначені лише для навчання.</p>
      <div className="crypto-controls">
        {field('p', `Просте число p (3–${maxPrime})`)}
        {field('g', 'Генератор g')}
      </div>
      <button className="secondary-button" onClick={() => { invalidate(); setFields(example) }}>Відновити навчальний приклад</button>
    </section>
    <div className="charts-grid">
      {(['A', 'B'] as const).map(side => {
        const local = side === 'A' ? 'a' : 'b'
        const peer = side === 'A' ? 'B' : 'A'
        return <section className="profile-card crypto-form" key={side}>
          <h2>Сторона {side}</h2>
          {field(local, `Приватний ключ ${local} · залишається у сторони ${side}`)}
          <p>Відкритий ключ</p>
          <div className="crypto-output">{side} = g<sup>{local}</sup> mod p
            {exchange && <> = {exchange.g}<sup>{exchange[local]}</sup> mod {exchange.p} = <strong>{exchange[side]}</strong></>}
          </div>
          {exchange && secrets && <><p>Секрет сторони {side}</p>
            <div className="crypto-output">K<sub>{side}</sub> = {peer}<sup>{local}</sup> mod p = {exchange[peer]}<sup>{exchange[local]}</sup> mod {exchange.p} = <strong>{secrets[side]}</strong></div></>}
        </section>
      })}
    </div>
    <section className="profile-card">
      <div className="section-heading">
        <button className="secondary-button" onClick={() => prepare(true)}>Згенерувати приватні ключі</button>
        <button className="primary-button" onClick={() => prepare(false)}>Обчислити відкриті ключі</button>
      </div>
      {error && <p role="alert" className="message error">{error}</p>}
      <h2>Обмін відкритими ключами</h2>
      {exchange ? <div className="crypto-output" aria-live="polite">
        <div>Сторона A → Сторона B · відкритий ключ A = {exchange.A}</div>
        <div>Сторона B → Сторона A · відкритий ключ B = {exchange.B}</div>
      </div> : <p className="file-instructions">Введіть або згенеруйте приватні ключі та обчисліть A і B для обміну.</p>}
      <button className="primary-button" disabled={!exchange} onClick={computeSecrets}>Обчислити спільний секрет</button>
      {secrets && <p role="status" className={`message ${secrets.A === secrets.B ? 'success' : 'error'}`}>
        {secrets.A === secrets.B ? `Секрети збігаються. K_A = K_B = ${secrets.A}` : 'Секрети сторін відрізняються.'}
      </p>}
    </section>
  </div>
}
