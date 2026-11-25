export interface User { id: number; username: string; email: string; created_at: string }
export interface Session { access_token: string; expires_at: number; user: User }
export interface TokenInfo { header: { alg: string; typ: string }; payload: { sub: string; name?: string; email?: string; iat: number; exp: number }; signature: { verified: boolean; value: string; algorithm: string } }
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function api<T>(path: string, token?: string, body?: unknown, method?: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')}/api${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000), cache: 'no-store',
    })
  } catch { throw new Error('Не вдалося з’єднатися із сервером. Спробуйте ще раз.') }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, typeof data?.detail === 'string' ? data.detail.replaceAll('MiB', 'МіБ') : 'Перевірте введені дані та повторіть спробу.')
  return data as T
}
