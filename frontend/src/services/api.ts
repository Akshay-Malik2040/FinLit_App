const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const API_URL = import.meta.env.DEV ? '' : configuredApiUrl || ''

export type ApiExpense = {
  _id: string
  description: string
  amountPaise: number
  expenseDate: string
  payerId: { _id: string; displayName: string } | string
  createdBy: { _id: string; displayName: string } | string
  participants?: string[]
  allocations?: Array<{ userId: string; amountPaise: number; percentage?: number }>
  splitMethod?: 'equal' | 'custom' | 'percentage'
  voidedAt?: string
}

export type ApiMember = {
  id: string
  displayName: string
  role: 'admin' | 'member'
  status: 'active' | 'left'
}

export type ApiRoom = {
  _id: string
  publicId: string
  name: string
  recoveryQuestion?: string
  dissolveRequest?: {
    requestedBy: string
    requestedAt: string
    status: 'pending' | 'approved' | 'rejected'
    approvals: Array<{ userId: string; approved: boolean; decidedAt?: string }>
  }
}

export type ApiRoomMembership = {
  _id: string
  roomId: ApiRoom
  role: 'admin' | 'member'
  status: 'active' | 'left' | 'pending'
}

export type ExpenseDraft = {
  description?: string
  amountPaise: number
  payerId: string
  participantIds: string[]
}

export type ApiActivity = {
  _id: string
  action: string
  createdAt: string
  actorId?: { _id?: string; displayName: string }
  newValues?: Record<string, unknown>
  previousValues?: Record<string, unknown>
}

export type ApiSummary = {
  month: string
  roomSpentPaise: number
  youPaidPaise: number
  yourSharePaise: number
  paidForOthersPaise: number
}

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } }

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = (await response.json()) as ApiResponse<T>
  if (!response.ok || !body.success) {
    throw new ApiError(
      body.success ? 'REQUEST_FAILED' : body.error.code,
      body.success ? 'Request failed' : body.error.message
    )
  }
  return body.data
}

export function createSession(displayName: string) {
  return request<{ user: { id: string; displayName: string } }>('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  })
}

export function getCurrentUser() {
  return request<{ user: { id: string; displayName: string } }>('/api/auth/me')
}

export function logout() {
  return request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function listExpenses(roomId: string) {
  return request<{ expenses: ApiExpense[]; total: number }>(`/api/rooms/${roomId}/expenses`)
}

export function listRooms() {
  return request<{ rooms: ApiRoomMembership[] }>('/api/rooms')
}

export function createRoom(name: string, recoveryPassword?: string, recoveryQuestion?: string) {
  return request<{ room: ApiRoom }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, recoveryPassword, recoveryQuestion }),
  })
}

export function recoverRoom(roomId: string, recoveryPassword: string) {
  return request<{ room: ApiRoom; membership: ApiRoomMembership }>('/api/rooms/recover', {
    method: 'POST',
    body: JSON.stringify({ roomId, recoveryPassword }),
  })
}

export function removeMember(roomId: string, membershipId: string) {
  return request<{ membership: unknown }>(`/api/rooms/${roomId}/members/${membershipId}`, {
    method: 'DELETE',
  })
}

export function decideDissolveRequest(roomId: string, action: 'approve' | 'reject') {
  return request<{ room: ApiRoom; status: string; dissolved?: boolean }>(`/api/rooms/${roomId}/dissolve/decide`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export function getRoom(roomId: string) {
  return request<{
    room: ApiRoom
    members: Array<{
      _id: string
      userId: { _id: string; displayName: string }
      role: 'admin' | 'member'
      status: 'active' | 'left'
    }>
  }>(`/api/rooms/${roomId}`)
}

export function createExpense(roomId: string, draft: ExpenseDraft) {
  return request<{ expense: ApiExpense }>(`/api/rooms/${roomId}/expenses`, {
    method: 'POST',
    body: JSON.stringify({ ...draft, splitMethod: 'equal' }),
  })
}

export function recordPayment(roomId: string, toUserId: string, amountPaise: number) {
  return request<{ payment: unknown }>(`/api/rooms/${roomId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ toUserId, amountPaise }),
  })
}

export function leaveRoom(roomId: string) {
  return request<{ membership: unknown; requiresApproval?: boolean; dissolved?: boolean }>(`/api/rooms/${roomId}/leave`, {
    method: 'POST',
  })
}

export type ApiPendingPayment = {
  _id: string
  fromUserId: { _id: string; displayName: string } | string
  toUserId: { _id: string; displayName: string } | string
  amountPaise: number
  paymentDate: string
  status: 'pending' | 'completed' | 'rejected'
  recordedBy?: { _id: string; displayName: string } | string
}

export function getBalances(roomId: string) {
  return request<{
    balances: Array<{ userId: string; amountPaise: number }>
    suggestions: Array<{ fromUserId: string; toUserId: string; amountPaise: number }>
    pendingPayments?: ApiPendingPayment[]
  }>(`/api/rooms/${roomId}/balances`)
}

export function getActivity(roomId: string) {
  return request<{ events: ApiActivity[] }>(`/api/rooms/${roomId}/activity`)
}

export function getSummary(roomId: string) {
  return request<ApiSummary>(`/api/rooms/${roomId}/summary`)
}

export function getExpenseHistory(expenseId: string) {
  return request<{ history: ApiActivity[] }>(`/api/expenses/${expenseId}/history`)
}

export function updateExpense(expenseId: string, draft: Partial<ExpenseDraft>) {
  return request<{ expense: ApiExpense }>(`/api/expenses/${expenseId}`, {
    method: 'PATCH',
    body: JSON.stringify(draft),
  })
}

export function voidExpense(expenseId: string) {
  return request<{ expense: ApiExpense }>(`/api/expenses/${expenseId}/void`, {
    method: 'POST',
  })
}

export function listJoinRequests(roomId: string) {
  return request<{ requests: Array<{ _id: string; userId: { displayName: string } }> }>(
    `/api/rooms/${roomId}/requests`
  )
}

export function decideJoinRequest(roomId: string, membershipId: string, action: 'approve' | 'reject') {
  return request(`/api/rooms/${roomId}/requests/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  })
}

export function decidePayment(roomId: string, paymentId: string, action: 'approve' | 'reject') {
  return request<{ payment: ApiPendingPayment }>(`/api/rooms/${roomId}/payments/${paymentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  })
}

export function joinRoom(roomId: string) {
  return request<{ membership: unknown }>(`/api/rooms/join`, {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  })
}

export const apiIsConfigured = true

