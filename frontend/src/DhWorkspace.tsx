import { useRef, useState } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { ArrowLeftRight, BookOpen, KeyRound, ScanEye, ShieldAlert, UserRound } from 'lucide-react'
import { generatePrivateKey, maxPrime, modPow, parameters, privateKey } from './diffieHellman'
import './dh.css'

const first = 'Сторона 1', second = 'Сторона 2', middle = 'Людина посередині'
const example = { p: '23', g: '5', a: '6', b: '15' }
const tabs = ['Огляд протоколу', 'Обмін ключами', 'MITM Attack']
const icons = [BookOpen, ArrowLeftRight, ScanEye]
const directSteps = ['Приватні ключі', 'Відкриті ключі', 'Обмін', 'Спільний секрет', 'Перевірка']
const mitmSteps = ['Приватні ключі', 'Відкриті ключі', 'Надіслані ключі', 'Отримані ключі', 'Два секрети', 'Перевірка']

function pair(p: number, g: number, a: number, b: number) {
  const A = modPow(g, a, p), B = modPow(g, b, p)
  return { p, g, a, b, A, B, left: modPow(B, a, p), right: modPow(A, b, p) }
}

function pairedExample() {
  const p = 23, g = 5
  const a = generatePrivateKey(p), x = generatePrivateKey(p)
  const left = pair(p, g, a, x)
  // A full-order B makes distinct example secrets possible for every left pair.
  let b = generatePrivateKey(p)
  while (b === x || b % 2 === 0 || b === 11) b = generatePrivateKey(p)
  const B = modPow(g, b, p)
  let y = generatePrivateKey(p)
  while (y === a || y === x || modPow(B, y, p) === left.left) y = generatePrivateKey(p)
  return { left, right: pair(p, g, y, b) }
}

function Power({ label, base, exponent, p, result }: { label: string; base: number; exponent: number; p: number; result: number }) {
  return <div className="dh-math">{label} = {base}<sup>{exponent}</sup> mod {p} = <strong>{result}</strong></div>
}

function Participant({ name, children }: { name: string; children: ReactNode }) {
  const Icon = name === middle ? ScanEye : UserRound
  return <section className={'dh-person' + (name === middle ? ' dh-middle' : '')}>
    <h3><Icon size={17} aria-hidden="true" />{name}</h3>{children}
  </section>
}

function Wire({ children, active = false }: { children?: ReactNode; active?: boolean }) {
  return <div className={'dh-wire' + (active ? ' active' : '')}><ArrowLeftRight size={23} aria-hidden="true" />{children}</div>
}

function Protection() {
  return <aside className="dh-defense"><h3>Як підтвердити особу учасника</h3>
    <p>Цифровий підпис пов’язує відкриті значення поточного обміну з ключем підписувача. Сертифікат пов’язує ключ перевірки підпису з іменем учасника. Перед прийняттям секрету перевіряють підпис, ланцюжок довіри, ім’я та строк дії сертифіката.</p>
    <p>Інший варіант автентифікації — підтвердити відбитки ключів через уже довірений канал.</p>
  </aside>
}

function Overview() {
  return <section className="profile-card dh-panel">
    <h2>Як виникає спільний секрет</h2>
    <p>Діффі — Хеллман дозволяє двом учасникам узгодити секрет через відкритий канал. Із цього секрету потім виводять ключі для шифрування даних.</p>
    <p>Обидва учасники знають просте число <b>p</b> та генератор <b>g</b>. Малі числа в лабораторній дають змогу перевірити обчислення вручну.</p>
    <div className="dh-map">
      <Participant name={first}><p>Обирає приватне a</p><div className="dh-math">A = g<sup>a</sup> mod p</div></Participant>
      <Wire active><span>A →<br />← B</span></Wire>
      <Participant name={second}><p>Обирає приватне b</p><div className="dh-math">B = g<sup>b</sup> mod p</div></Participant>
    </div>
    <h3>Чому значення збігаються</h3>
    <div className="dh-math">B<sup>a</sup> ≡ g<sup>ab</sup> ≡ A<sup>b</sup> (mod p)</div>
    <p>Через канал проходять A та B. Кожна сторона підносить отримане значення до свого приватного степеня. За належно вибраних великих параметрів сторонньому спостерігачу обчислити секрет практично складно.</p>
    <h3>Кому належить отриманий ключ?</h3>
    <p>Сам обмін не підтверджує походження A та B. Якщо отримані значення належать іншому учаснику, математика працює, але кожна сторона узгоджує секрет із ним. Це показує вкладка MITM Attack.</p>
    <Protection />
  </section>
}

function Walkthrough({ steps, step, start, next, reset }: {
  steps: string[]; step: number; start: () => void; next: () => void; reset: () => void
}) {
  return <>
    <ol className="dh-progress" aria-label="Етапи демонстрації">{steps.map((name, i) =>
      <li key={name} aria-current={i + 1 === step ? 'step' : undefined} className={i + 1 < step ? 'done' : ''}>{i + 1}. {name}</li>)}</ol>
    <div className="dh-actions">
      {step === 0 ? <button className="primary-button" onClick={start}>Почати</button> :
        <button className="primary-button" disabled={step === steps.length} onClick={next}>Наступний крок</button>}
      <button className="secondary-button" onClick={reset}>Скинути</button>
    </div>
    <p className="dh-caption" aria-live="polite">{step ? `Крок ${step} із ${steps.length} · ${steps[step - 1]}` : 'Готово до початку'}</p>
  </>
}

function Exchange() {
  const [fields, setFields] = useState(example)
  const [run, setRun] = useState<ReturnType<typeof pair> | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  function reset() { setStep(0); setRun(null); setError('') }
  function prepare(random: boolean) {
    reset()
    try {
      const { p, g } = parameters(fields.p, fields.g)
      if (random) {
        setFields({ ...fields, a: String(generatePrivateKey(p)), b: String(generatePrivateKey(p)) })
        return
      }
      setRun(pair(p, g, privateKey(fields.a, 'a', p), privateKey(fields.b, 'b', p)))
      setStep(1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Перевірте параметри.') }
  }
  function field(name: keyof typeof example, label: string) {
    return <label>{label}<input name={name} inputMode="numeric" autoComplete="off" value={fields[name]}
      onChange={e => { reset(); setFields({ ...fields, [name]: e.target.value }) }} /></label>
  }
  function participant(isFirst: boolean) {
    const symbol = isFirst ? 'A' : 'B', received = isFirst ? 'B' : 'A'
    const exponent = isFirst ? 'a' : 'b'
    return <Participant name={isFirst ? first : second}>
      {field(exponent, 'Приватний ключ ' + exponent)}
      {run && step >= 2 && <Power label={symbol} base={run.g} exponent={run[exponent]} p={run.p} result={run[symbol]} />}
      {run && step >= 3 && <p>Отримано {received} = {run[received]}</p>}
      {run && step >= 4 && <Power label="K" base={run[received]} exponent={run[exponent]} p={run.p} result={isFirst ? run.left : run.right} />}
    </Participant>
  }
  return <section className="profile-card dh-panel crypto-form">
    <h2>Параметри обміну</h2>
    <div className="dh-params">{field('p', `Просте число p (3–${maxPrime})`)}{field('g', 'Генератор g')}</div>
    <p>Введіть приватні ключі від 1 до p − 2 або згенеруйте їх. Кожен ключ залишається у свого власника.</p>
    <button className="secondary-button" onClick={() => prepare(true)}>Згенерувати приватні ключі</button>
    <Walkthrough steps={directSteps} step={step} start={() => prepare(false)} next={() => setStep(s => Math.min(s + 1, directSteps.length))} reset={reset} />
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="dh-map">{participant(true)}<Wire active={step >= 3}>{run && step >= 3 && <span>A = {run.A} →<br />← B = {run.B}</span>}</Wire>{participant(false)}</div>
    {run && step === 5 && <p className={'message ' + (run.left === run.right ? 'success' : 'error')} role="status">Секрети {run.left === run.right ? 'збігаються' : 'відрізняються'} · {run.left} {run.left === run.right ? '=' : '≠'} {run.right}</p>}
  </section>
}

function Mitm() {
  const [run, setRun] = useState<ReturnType<typeof pairedExample> | null>(null)
  const [step, setStep] = useState(0)
  const l = run?.left, r = run?.right
  return <section className="profile-card dh-panel">
    <h2>Обмін без автентифікації</h2>
    <p>У моделі p = 23, g = 5. Простежте, які відкриті значення надсилає кожна сторона та які зрештою отримує. Новий запуск добирає ключі так, щоб обидві підміни й різницю секретів було видно.</p>
    <Walkthrough steps={mitmSteps} step={step} start={() => { setRun(pairedExample()); setStep(1) }}
      next={() => setStep(s => Math.min(s + 1, mitmSteps.length))} reset={() => { setRun(null); setStep(0) }} />
    {step === 3 && <p>Обидва вихідні ключі A та B отримує Людина посередині.</p>}
    {step === 4 && <p>Сторона 1 отримує X замість B. Сторона 2 отримує Y замість A. Без перевірки походження обидва значення виглядають як звичайні відкриті ключі.</p>}
    <div className="dh-map dh-three">
      <Participant name={first}>
        {l && <p>Приватний a = {l.a}</p>}
        {l && step >= 2 && <Power label="A" base={l.g} exponent={l.a} p={l.p} result={l.A} />}
        {l && r && step >= 4 && <p>Очікується B = {r.B}<br />Отримано X = {l.B}</p>}
        {l && step >= 5 && <Power label="K₁" base={l.B} exponent={l.a} p={l.p} result={l.left} />}
      </Participant>
      <Wire active={step >= 3}>{l && step >= 3 && <span>A = {l.A} →{step >= 4 && <><br />← X = {l.B}</>}</span>}</Wire>
      <Participant name={middle}>
        {l && r && <p>Приватні x = {l.b}, y = {r.a}</p>}
        {l && r && step >= 2 && <><Power label="X" base={l.g} exponent={l.b} p={l.p} result={l.B} /><Power label="Y" base={r.g} exponent={r.a} p={r.p} result={r.A} /></>}
        {l && r && step >= 3 && <p>Отримано A = {l.A}, B = {r.B}</p>}
        {l && r && step >= 5 && <><Power label="K₁" base={l.A} exponent={l.b} p={l.p} result={l.right} /><Power label="K₂" base={r.B} exponent={r.a} p={r.p} result={r.left} /></>}
      </Participant>
      <Wire active={step >= 3}>{r && step >= 3 && <span>← B = {r.B}{step >= 4 && <><br />Y = {r.A} →</>}</span>}</Wire>
      <Participant name={second}>
        {r && <p>Приватний b = {r.b}</p>}
        {r && step >= 2 && <Power label="B" base={r.g} exponent={r.b} p={r.p} result={r.B} />}
        {l && r && step >= 4 && <p>Очікується A = {l.A}<br />Отримано Y = {r.A}</p>}
        {r && step >= 5 && <Power label="K₂" base={r.A} exponent={r.b} p={r.p} result={r.right} />}
      </Participant>
    </div>
    {l && r && step === 6 && <div role="status" className="dh-results">
      {[[first, middle, l.left, l.right], [middle, second, r.left, r.right]].map(([a, b, s, t]) =>
        <p key={a} className={'message ' + (s === t ? 'success' : 'error')}><KeyRound size={16} />{a} ↔ {b} · {s} {s === t ? '=' : '≠'} {t}</p>)}
      <p className={'message ' + (l.left === r.right ? 'success' : 'error')}><ShieldAlert size={16} />{first} ↔ {second} · {l.left} {l.left === r.right ? '=' : '≠'} {r.right}</p>
      <Protection />
    </div>}
  </section>
}

export default function DiffieHellmanLab({ algorithmChoice }: { algorithmChoice: ReactNode }) {
  const [tab, setTab] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  function navigate(event: KeyboardEvent, index: number) {
    const targets: Record<string, number> = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault(); setTab(target); buttons.current[target]?.focus()
  }
  return <div className="crypto-lab dh-lab">
    <div className="profile-card">{algorithmChoice}
      <div className="dh-tabs" role="tablist" aria-label="Діффі — Хеллман">{tabs.map((name, i) => {
        const Icon = icons[i]
        return <button key={name} role="tab" id={'dh-tab-' + i} aria-controls={'dh-panel-' + i}
          aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} onClick={() => setTab(i)}
          ref={el => { buttons.current[i] = el }} onKeyDown={e => navigate(e, i)}><Icon size={16} />{name}</button>
      })}</div>
    </div>
    {[<Overview />, <Exchange />, <Mitm />].map((panel, i) =>
      <div key={i} role="tabpanel" id={'dh-panel-' + i} aria-labelledby={'dh-tab-' + i} tabIndex={0} hidden={tab !== i}>{panel}</div>)}
  </div>
}
