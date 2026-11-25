import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { TokenInfo } from './api'

export default function SessionSecurity({ expiresAt, info }: { expiresAt: number; info: TokenInfo | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const update = () => setNow(Date.now())
    update()
    const timer = setInterval(update, 1000)
    window.addEventListener('focus', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update) }
  }, [expiresAt])
  const remaining = Math.max(0, Math.ceil((expiresAt * 1000 - now) / 1000))
  const total = info ? Math.max(1, info.payload.exp - info.payload.iat) : null
  const percent = total ? Math.min(100, remaining / total * 100) : 0
  return <section className="session-security"><div className="session-heading"><h2><ShieldCheck size={19} aria-hidden="true" /> Безпека сесії</h2><span className="session-status">{remaining > 0 ? 'Активна' : 'Завершена'}</span></div><div className="session-time"><span>До завершення</span><time aria-label="Час до завершення сесії">{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</time></div>{total !== null && <div className="session-progress" role="progressbar" aria-label="Залишок часу сесії" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><div style={{ width: `${percent}%` }} /></div>}{info && <details className="compact-details"><summary>Деталі JWT</summary><div className="jwt-grid">{[['Header', info.header], ['Payload', { sub: info.payload.sub, ...(info.payload.name !== undefined ? { name: info.payload.name } : {}), ...(info.payload.email !== undefined ? { email: info.payload.email } : {}) }]].map(([title, values]) => <div className="jwt-block" key={String(title)}><h3>{String(title)}</h3><pre>{'{\n'}{Object.entries(values).map(([key, value], index, entries) => <span key={key}>{'  '}<span className="json-key">{JSON.stringify(key)}</span>: <span className={typeof value === 'number' ? 'json-number' : 'json-value'}>{JSON.stringify(value)}</span>{index < entries.length - 1 ? ',' : ''}{'\n'}</span>)}{'}'}</pre></div>)}</div></details>}</section>
}
