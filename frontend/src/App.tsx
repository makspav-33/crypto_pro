import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronRight, Clock3, FlaskConical, FolderLock, LayoutDashboard, LogOut, Menu, Shield, UserRound, X } from 'lucide-react'
import { api, ApiError } from './api'
import CryptoLab from './CryptoLab'
import Activity from './Activity'
import SessionSecurity from './SessionSecurity'
import type { Session, TokenInfo, User } from './api'

const modules = [
  { id: 'dashboard', label: 'Панель керування', icon: LayoutDashboard },
  { id: 'lab', label: 'Криптолабораторія', icon: FlaskConical },
  { id: 'files', label: 'Шифрування файлів', icon: FolderLock },
  { id: 'history', label: 'Історія', icon: Clock3 },
  { id: 'profile', label: 'Профіль', icon: UserRound },
]
const getPage = () => location.hash.slice(1) || 'dashboard'

function AuthForm({ register, onLogin, notice }: { register: boolean; onLogin: (session: Session) => void; notice: string }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email')).trim().toLowerCase()
    const password = String(data.get('password'))
    setError('')
    if (register && password !== data.get('confirm')) { setError('Паролі не збігаються.'); return }
    setBusy(true)
    let registered = false
    try {
      if (register) {
        await api<User>('/auth/register', undefined, { username: String(data.get('username')).trim(), email, password })
        registered = true
      }
      if (!active.current) return
      const session = await api<Session>('/auth/login', undefined, { email, password })
      if (!active.current) return
      form.reset()
      onLogin(session)
    } catch (e) { if (active.current) setError(`${registered ? 'Акаунт створено. Автовхід не вдався; спробуйте увійти. ' : ''}${e instanceof Error ? e.message : 'Не вдалося виконати запит.'}`) }
    finally { if (active.current) setBusy(false) }
  }
  return <div className="auth-screen"><section className="auth-card"><a className="brand" href="#login"><span className="brand-icon"><Shield /></span>Digital<span>Vault</span><span className="brand-dot">.</span></a><h1>{register ? 'Реєстрація' : 'Вхід'}<span>.</span></h1>
    {notice && <p role="status" className="message">{notice}</p>}
    {error && <p role="alert" className="message error">{error}</p>}
    <form onSubmit={submit}>
      {register && <label>Ім’я користувача<input name="username" autoComplete="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]{3,40}" title="3–40 латинських літер, цифр, крапок, дефісів або підкреслень" disabled={busy} /></label>}
      <label>Електронна пошта<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label>
      <label>Пароль<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : 1} maxLength={128} disabled={busy} /></label>
      {register && <><small className="muted">Від 12 до 128 символів.</small><label>Підтвердження пароля<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} /></label></>}
      <button className="primary-button" disabled={busy}>{busy ? 'Зачекайте…' : register ? 'Створити акаунт' : 'Увійти'}<ChevronRight size={16} /></button>
    </form><p className="auth-link">{register ? 'Уже маєте акаунт?' : 'Ще немає акаунта?'} <a href={register ? '#login' : '#register'}>{register ? 'Увійти' : 'Зареєструватися'}</a></p></section></div>
}

function Profile({ session, logout }: { session: Session; logout: (reason?: string) => void }) {
  const [user, setUser] = useState<User | null>(null)
  const [info, setInfo] = useState<TokenInfo | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    Promise.all([api<User>('/auth/me', session.access_token), api<TokenInfo>('/auth/token-info', session.access_token)])
      .then(([u, i]) => { if (!cancelled) { setUser(u); setInfo(i) } })
      .catch(e => { if (cancelled) return; if (e instanceof ApiError && e.status === 401) logout('Сесію завершено. Увійдіть повторно.'); else setError(e.message) })
    return () => { cancelled = true }
  }, [session])
  return <section className="profile-card">{error && <p role="alert" className="message error">{error}</p>}{user ? <><div className="profile-identity"><div className="avatar"><UserRound size={30} /></div><div><h2>{user.username}</h2><p>{user.email}</p></div></div><dl><dt>Дата реєстрації</dt><dd>{new Date(user.created_at).toLocaleString('uk-UA')}</dd></dl></> : !error && <p role="status">Завантаження…</p>}<SessionSecurity expiresAt={session.expires_at} info={info} /></section>
}

export default function App() {
  const [page, setPage] = useState(getPage)
  const [session, setSession] = useState<Session | null>(null)
  const activeSession = useRef<Session | null>(null)
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const logout = (reason = '') => {
    // A delayed 401 from an earlier login belongs only to that session.
    if (activeSession.current !== session) return
    activeSession.current = null
    setSession(null); setNotice(reason); setMenuOpen(false); location.hash = 'login'
  }
  function login(next: Session) {
    activeSession.current = next
    setSession(next); setNotice(''); location.hash = 'dashboard'
  }
  useEffect(() => {
    const handler = () => { setPage(getPage()); setMenuOpen(false) }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (!session && page !== 'login' && page !== 'register') location.replace('#login')
    if (session && !modules.some(m => m.id === page)) location.replace('#dashboard')
  }, [session, page])
  useEffect(() => {
    if (!session) return
    let timer: ReturnType<typeof setTimeout>
    const expire = () => {
      clearTimeout(timer)
      const remaining = session.expires_at * 1000 - Date.now()
      if (remaining <= 0) logout('Термін дії сесії завершився. Увійдіть повторно.')
      else timer = setTimeout(expire, remaining)
    }
    expire()
    window.addEventListener('focus', expire)
    return () => { clearTimeout(timer); window.removeEventListener('focus', expire) }
  }, [session])
  if (!session || session.expires_at * 1000 <= Date.now()) return <AuthForm key={page === 'register' ? 'register' : 'login'} register={page === 'register'} notice={notice} onLogin={login} />
  const active = modules.find(m => m.id === page) || modules[0]
  return <div className="app-shell"><button className="mobile-menu" aria-label="Меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button><aside className={menuOpen ? 'sidebar open' : 'sidebar'}><a href="#dashboard" className="brand"><span className="brand-icon"><Shield /></span>Digital<span>Vault</span><span className="brand-dot">.</span></a><nav aria-label="Основна навігація">{modules.filter(m => m.id !== 'profile').map(m => <a key={m.id} href={`#${m.id}`} className={`nav-link ${active.id === m.id ? 'active' : ''}`} aria-current={active.id === m.id ? 'page' : undefined}><m.icon size={19} /><span>{m.label}</span></a>)}</nav><div className="sidebar-bottom"><a href="#profile" className={`local-user profile-link ${active.id === 'profile' ? 'selected' : ''}`} aria-label="Профіль"><div className="avatar"><UserRound size={18} /></div><div className="user-summary">{session.user.username}<small>{session.user.email}</small></div></a><button className="logout-button" onClick={() => logout()}><LogOut size={16} /> Вийти</button></div></aside><div className="main-shell"><main><div className="page-heading"><div><h1><Shield className="heading-icon" size={23} aria-hidden="true" />{active.id === 'dashboard' ? `Вітаємо, ${session.user.username}` : active.label}<span>.</span></h1>{active.id === 'dashboard' && <p className="dashboard-subtitle">Ваші операції, інструменти й безпека — в одному просторі.</p>}</div></div>
  {active.id === 'lab' || active.id === 'files' ? <CryptoLab key={active.id} token={session.access_token} files={active.id === 'files'} logout={logout} /> : active.id === 'profile' ? <Profile session={session} logout={logout} /> : <Activity key={active.id} token={session.access_token} dashboard={active.id === 'dashboard'} logout={logout} />}
</main></div></div>
}
