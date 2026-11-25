import { useEffect, useState } from 'react'
import { ArrowUpRight, RefreshCw, Trash2, ShieldCheck, LockKeyhole, UnlockKeyhole, FileKey, Layers } from 'lucide-react'
import { api, ApiError } from './api'

interface Entry { id: number; created_at: string; algorithm: string; operation: string; data_type: string; filename: string | null; status: string }
interface History { items: Entry[]; total: number }
interface Stats { total_operations: number; encryptions: number; decryptions: number; files_processed: number; most_used_algorithm: string | null; algorithms: { algorithm: string; count: number }[]; activity: { date: string; count: number }[]; recent: Entry[] }
const names: Record<string, string> = { caesar: 'Шифр Цезаря', horizontal: 'Горизонтальна перестановка', vertical: 'Вертикальна перестановка', combined: 'Комбінована перестановка' }
function MetricIcon({ index }: { index: number }) { const Icon = [Layers, LockKeyhole, UnlockKeyhole, FileKey, ShieldCheck][index]; return <Icon size={16} aria-hidden="true" /> }
const formatDate = (date: string) => new Date(date).toLocaleString('uk-UA')

function Operations({ rows, remove, busy = false }: { rows: Entry[]; remove?: (id: number) => void; busy?: boolean }) {
  return <div className="table-scroll"><table className="history-table"><thead><tr><th>№ / Дата й час</th><th>Алгоритм</th><th>Операція</th><th>Дані</th><th>Файл</th><th>Статус</th>{remove && <th>Дія</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><span className="record-id">#{row.id}</span><time dateTime={row.created_at}>{formatDate(row.created_at)}</time></td><td>{names[row.algorithm] || row.algorithm}</td><td><span className={`operation-badge ${row.operation}`}>{row.operation === 'encrypt' ? 'Шифрування' : 'Розшифрування'}</span></td><td>{row.data_type === 'file' ? 'Файл' : 'Текст'}</td><td className="filename" title={row.filename || ''}>{row.filename || '—'}</td><td><span className="success-label">● {row.status === 'success' ? 'Успішно' : row.status}</span></td>{remove && <td><button className="icon-button danger" disabled={busy} aria-label={`Видалити запис ${row.id}`} onClick={() => remove(row.id)}><Trash2 size={16} /></button></td>}</tr>)}</tbody></table></div>
}

export default function Activity({ token, dashboard = false, logout }: { token: string; dashboard?: boolean; logout: (reason?: string) => void }) {
  const [history, setHistory] = useState<History | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [search, setSearch] = useState('')
  const [algorithm, setAlgorithm] = useState('')
  const [operation, setOperation] = useState('')
  const [type, setType] = useState('')
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<number | 'all' | null>(null)
  useEffect(() => {
    const handler = () => setRefresh(value => value + 1)
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search, limit: '25', offset: String(offset) })
      if (algorithm) query.set('algorithm', algorithm)
      if (operation) query.set('operation', operation)
      if (type) query.set('data_type', type)
      const request = dashboard ? api<Stats>('/history/stats', token) : api<History>(`/history?${query}`, token)
      request.then(data => {
        if (cancelled) return
        if (dashboard) setStats(data as Stats)
        else {
          const list = data as History
          if (offset && !list.items.length) setOffset(Math.max(0, Math.ceil(list.total / 25) * 25 - 25))
          setHistory(list)
        }
      }).catch(e => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 401) logout('Сесію завершено. Увійдіть повторно.')
        else setError(e instanceof Error ? e.message : 'Не вдалося завантажити історію.')
      }).finally(() => { if (!cancelled) setLoading(false) })
    }, search ? 250 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [token, dashboard, search, algorithm, operation, type, offset, refresh])
  async function remove() {
    if (confirm === null) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`/history${confirm === 'all' ? '' : `/${confirm}`}`, token, undefined, 'DELETE')
      setNotice(confirm === 'all' ? 'Власну історію очищено.' : 'Запис видалено.')
      setConfirm(null); setRefresh(v => v + 1)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout('Сесію завершено. Увійдіть повторно.')
      else setError(e instanceof Error ? e.message : 'Не вдалося видалити запис.')
      setConfirm(null)
    } finally { setBusy(false) }
  }
  const filter = (setter: (value: string) => void, value: string) => { setter(value); setOffset(0) }
  return <div className="activity-page"><div className="activity-toolbar"><button className="secondary-button" disabled={loading || busy} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14} /> Оновити</button></div>{error && <p role="alert" className="message error">{error}</p>}{notice && <p role="status" className="message success">{notice}</p>}
  {!dashboard && <section className="profile-card"><div className="section-heading"><button className="secondary-button danger" disabled={loading || busy || !history?.total} onClick={() => setConfirm('all')}><Trash2 size={14} /> Очистити всю історію</button></div><div className="history-filters"><label>Пошук<input type="search" placeholder="Назва файлу, алгоритм, номер…" value={search} onChange={e => filter(setSearch, e.target.value)} /></label><label>Алгоритм<select value={algorithm} onChange={e => filter(setAlgorithm, e.target.value)}><option value="">Усі алгоритми</option>{Object.entries(names).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Операція<select value={operation} onChange={e => filter(setOperation, e.target.value)}><option value="">Усі операції</option><option value="encrypt">Шифрування</option><option value="decrypt">Розшифрування</option></select></label><label>Тип даних<select value={type} onChange={e => filter(setType, e.target.value)}><option value="">Усі типи</option><option value="text">Текст</option><option value="file">Файл</option></select></label></div>{loading ? <p role="status" className="empty-state">Завантаження…</p> : !error && history && <>{history.items.length ? <Operations rows={history.items} remove={setConfirm} busy={busy} /> : <div className="empty-state"><h3>{search || algorithm || operation || type ? 'За цими фільтрами нічого не знайдено' : 'Ваша історія поки порожня'}</h3><p>Виконайте операцію в <a href="#lab">Криптолабораторія</a> або <a href="#files">Шифрування файлів</a>.</p></div>}<div className="pagination"><span>{history.total ? `${offset + 1}–${Math.min(offset + 25, history.total)} з ${history.total}` : '0 записів'}</span><div><button className="secondary-button" disabled={!offset || busy} onClick={() => setOffset(v => Math.max(0, v - 25))}>Назад</button><button className="secondary-button" disabled={offset + 25 >= history.total || busy} onClick={() => setOffset(v => v + 25)}>Далі</button></div></div></>}</section>}
  {dashboard && (loading ? <p role="status" className="empty-state">Завантаження статистики…</p> : !error && stats && <><section className="metrics-grid">{[['Усього операцій', stats.total_operations], ['Зашифровано', stats.encryptions], ['Розшифровано', stats.decryptions], ['Оброблено файлів', stats.files_processed], ['Найпопулярніший алгоритм', stats.most_used_algorithm ? names[stats.most_used_algorithm] : '—']].map(([label, value], index) => <div className="metric-card" key={label}><span><MetricIcon index={index} /> {label}</span><strong className={typeof value === 'number' ? 'stat-number' : undefined}>{value}</strong></div>)}</section><div className="charts-grid"><section className="profile-card"><h2>Активність за 7 днів <small>(UTC)</small></h2><div className="activity-chart" role="img" aria-label={stats.activity.map(d => `${d.date}: ${d.count}`).join('; ')}>{stats.activity.map(day => <div className="chart-day" key={day.date}><span>{day.count}</span><div className="bar-track"><div className="activity-bar" style={{ height: `${day.count / Math.max(1, ...stats.activity.map(d => d.count)) * 100}%` }} /></div><small>{day.date.slice(5).replace('-', '.')}</small></div>)}</div></section><section className="profile-card"><h2>Розподіл за алгоритмами</h2>{stats.algorithms.length ? stats.algorithms.map(item => <div className="distribution" key={item.algorithm}><div><span>{names[item.algorithm]}</span><strong>{item.count} · {Math.round(item.count / stats.total_operations * 100)}%</strong></div><div className="distribution-track"><div style={{ width: `${item.count / stats.total_operations * 100}%` }} /></div></div>) : <p className="empty-state">Ще немає операцій.</p>}</section></div><section className="profile-card"><div className="section-heading"><h2>Останні операції</h2><a className="text-link" href="#history">Уся історія →</a></div>{stats.recent.length ? <Operations rows={stats.recent} /> : <p className="empty-state">Виконайте першу операцію — тут з’явиться результат.</p>}</section><section className="quick-links"><a href="#lab"><span>Криптолабораторія<small>Текст, алгоритми та візуалізації</small></span><ArrowUpRight /></a><a href="#files"><span>Шифрування файлів<small>Шифрування UTF-8 файлів</small></span><ArrowUpRight /></a></section></>)}
  {confirm !== null && <div className="confirm-overlay"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"><h2 id="confirm-title">{confirm === 'all' ? 'Очистити всю власну історію?' : `Видалити запис #${confirm}?`}</h2><p id="confirm-description">Цю дію неможливо скасувати. {confirm === 'all' ? 'Будуть видалені всі ваші записи, включно з тими, що приховані фільтрами. Статистика також обнулиться.' : 'Статистика буде перерахована.'}</p><div><button autoFocus className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>Скасувати</button><button className="primary-button" disabled={busy} onClick={remove}>{busy ? 'Видалення…' : 'Підтвердити видалення'}</button></div></section></div>}
  </div>
}
