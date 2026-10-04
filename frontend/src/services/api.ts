const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const API_URL = import.meta.env.DEV ? '' : configuredApiUrl || ''

export type ApiExpense = {
  _id: string
  description: string
  amountPaise: number
  expenseDate: string
  payerId: { _id: string; displayName: string } | string
  createdBy: { _id: string; displayName: string } | string
  voidedAt?: string
}
export type ApiMember = { id: string; displayName: string; role: 'admin' | 'member'; status: 'active' | 'left' }
export type ApiRoom = { _id: string; publicId: string; name: string }
export type ExpenseDraft = { description?: string; amountPaise: number; payerId: string; participantIds: string[] }
export type ApiActivity = { _id: string; action: string; createdAt: string; actorId?: { displayName: string } }
export type ApiSummary = { month: string; roomSpentPaise: number; youPaidPaise: number; yourSharePaise: number; paidForOthersPaise: number }

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } }
export class ApiError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json() as ApiResponse<T>
  if (!response.ok || !body.success) throw new ApiError(body.success ? 'REQUEST_FAILED' : body.error.code, body.success ? 'Request failed' : body.error.message)
  return body.data
}

export async function ensureSession(displayName: string) {
  try { return await request<{ user: { id: string; displayName: string } }>('/api/auth/me') }
  catch { return request<{ user: { id: string; displayName: string } }>('/api/auth/session', { method: 'POST', body: JSON.stringify({ displayName }) }) }
}
export function getCurrentUser() { return request<{ user: { id: string; displayName: string } }>('/api/auth/me') }
export function logout() { return request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }) }

export function listExpenses(roomId: string) { return request<{ expenses: ApiExpense[] }>(`/api/rooms/${roomId}/expenses`) }
export function listRooms() { return request<{ rooms: Array<{ roomId: ApiRoom; role: string; status: 'pending' | 'active' | 'left' }> }>('/api/rooms') }
export function createRoom(name: string) { return request<{ room: ApiRoom }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }) }
export function getRoom(roomId: string) { return request<{ room: ApiRoom; members: Array<{ userId: { _id: string; displayName: string }; role: 'admin' | 'member'; status: 'active' | 'left' }> }>(`/api/rooms/${roomId}`) }
export function createExpense(roomId: string, draft: ExpenseDraft) { return request<{ expense: ApiExpense }>(`/api/rooms/${roomId}/expenses`, { method: 'POST', body: JSON.stringify({ ...draft, splitMethod: 'equal' }) }) }
export function recordPayment(roomId: string, toUserId: string, amountPaise: number) { return request(`/api/rooms/${roomId}/payments`, { method: 'POST', body: JSON.stringify({ toUserId, amountPaise }) }) }
export function leaveRoom(roomId: string) { return request(`/api/rooms/${roomId}/leave`, { method: 'POST' }) }
export function getBalances(roomId: string) { return request<{ balances: Array<{ userId: string; amountPaise: number }>; suggestions: Array<{ fromUserId: string; toUserId: string; amountPaise: number }> }>(`/api/rooms/${roomId}/balances`) }
export function getActivity(roomId: string) { return request<{ events: ApiActivity[] }>(`/api/rooms/${roomId}/activity`) }
export function getSummary(roomId: string) { return request<ApiSummary>(`/api/rooms/${roomId}/summary`) }
export function getExpenseHistory(expenseId: string) { return request<{ history: ApiActivity[] }>(`/api/expenses/${expenseId}/history`) }
export function updateExpense(expenseId: string, draft: Partial<ExpenseDraft>) { return request<{ expense: ApiExpense }>(`/api/expenses/${expenseId}`, { method: 'PATCH', body: JSON.stringify(draft) }) }
export function listJoinRequests(roomId: string) { return request<{ requests: Array<{ _id: string; userId: { displayName: string } }> }>(`/api/rooms/${roomId}/requests`) }
export function decideJoinRequest(roomId: string, membershipId: string, action: 'approve' | 'reject') { return request(`/api/rooms/${roomId}/requests/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ action }) }) }
export function joinRoom(roomId: string) { return request<{ membership: { status: 'pending' | 'active' } }>(`/api/rooms/join`, { method: 'POST', body: JSON.stringify({ roomId }) }) }
export const apiIsConfigured = import.meta.env.DEV || Boolean(API_URL)
