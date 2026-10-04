const API_URL = import.meta.env.VITE_API_URL as string | undefined

export type ApiExpense = {
  _id: string
  description: string
  amountPaise: number
  expenseDate: string
  payerId: { _id: string; displayName: string } | string
  createdBy: { _id: string; displayName: string } | string
  voidedAt?: string
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('API is not configured')
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json() as ApiResponse<T>
  if (!response.ok || !body.success) throw new Error(body.success ? 'Request failed' : body.error.message)
  return body.data
}

export async function ensureSession(displayName: string) {
  try { return await request<{ user: { id: string; displayName: string } }>('/api/auth/me') }
  catch { return request<{ user: { id: string; displayName: string } }>('/api/auth/session', { method: 'POST', body: JSON.stringify({ displayName }) }) }
}

export function listExpenses(roomId: string) { return request<{ expenses: ApiExpense[] }>(`/api/rooms/${roomId}/expenses`) }
export const apiIsConfigured = Boolean(API_URL)
