import {
  createOptimisticExpense,
  createOptimisticPayment,
  enqueueOfflineAction,
  getCached,
  getOfflineQueue,
  getRoomScopedCache,
  isOfflineOrNetworkError,
  processOfflineSync,
  saveRoomScopedCache,
  setCached,
  type CachedBalances,
  type CachedRoomDetail,
  type OfflineAction,
} from './offlineSync'

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
  isEdited?: boolean
  voidedAt?: string
  voidRequest?: {
    requestedBy: { _id: string; displayName: string } | string
    requestedAt: string
    status: 'pending' | 'approved' | 'rejected'
  }
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

export type ApiPendingPayment = {
  _id: string
  fromUserId: { _id: string; displayName: string } | string
  toUserId: { _id: string; displayName: string } | string
  amountPaise: number
  paymentDate: string
  status: 'pending' | 'completed' | 'rejected'
  recordedBy?: { _id: string; displayName: string } | string
}

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } }

const TOKEN_KEY = 'finlit_auth_token'

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore local storage restrictions
  }
}

export class ApiError extends Error {
  code: string
  status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const url = `${API_URL}${path}`
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers,
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (!API_URL && import.meta.env.PROD) {
      throw new ApiError(
        'CONFIG_ERROR',
        'Backend API URL is not set. Please add VITE_API_URL in your Vercel Environment Variables and redeploy.'
      )
    }
    throw new ApiError(
      'NETWORK_ERROR',
      `Cannot connect to server (${API_URL || 'local'}). (${errorMsg})`
    )
  }

  let body: ApiResponse<T>
  try {
    body = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(
      'INVALID_RESPONSE',
      `Server returned an invalid response (${response.status} ${response.statusText}). Check that VITE_API_URL points to your backend.`,
      response.status
    )
  }

  if (!response.ok || !body.success) {
    throw new ApiError(
      body.success ? 'REQUEST_FAILED' : body.error.code,
      body.success ? 'Request failed' : body.error.message,
      response.status
    )
  }
  return body.data
}

// Auth
export async function createSession(displayName: string) {
  const data = await request<{ user: { id: string; displayName: string }; token?: string }>('/api/auth/session', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  })
  if (data.token) {
    setStoredToken(data.token)
  }
  if (data.user) {
    setCached('finlit_cache_user', data.user)
  }
  return data
}

export async function getCurrentUser() {
  try {
    const data = await request<{ user: { id: string; displayName: string } }>('/api/auth/me')
    if (data.user) {
      setCached('finlit_cache_user', data.user)
    }
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getCached<{ id: string; displayName: string }>('finlit_cache_user')
      if (cached) {
        return { user: cached }
      }
    }
    throw err
  }
}

export async function logout() {
  setStoredToken(null)
  setCached('finlit_cache_user', null)
  return request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }).catch(() => ({ loggedOut: true }))
}

// Rooms
export async function listRooms() {
  try {
    const data = await request<{ rooms: ApiRoomMembership[] }>('/api/rooms')
    setCached('finlit_cache_rooms', data.rooms)
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getCached<ApiRoomMembership[]>('finlit_cache_rooms')
      if (cached) {
        return { rooms: cached }
      }
    }
    throw err
  }
}

export async function createRoom(name: string, recoveryPassword?: string, recoveryQuestion?: string) {
  const data = await request<{ room: ApiRoom }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, recoveryPassword, recoveryQuestion }),
  })
  return data
}

export async function recoverRoom(roomId: string, recoveryPassword: string) {
  return request<{ room: ApiRoom; membership: ApiRoomMembership }>('/api/rooms/recover', {
    method: 'POST',
    body: JSON.stringify({ roomId, recoveryPassword }),
  })
}

export async function removeMember(roomId: string, membershipId: string) {
  return request<{ membership: unknown }>(`/api/rooms/${roomId}/members/${membershipId}`, {
    method: 'DELETE',
  })
}

export async function decideDissolveRequest(roomId: string, action: 'approve' | 'reject') {
  return request<{ room: ApiRoom; status: string; dissolved?: boolean }>(`/api/rooms/${roomId}/dissolve/decide`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

export async function getRoom(roomId: string) {
  try {
    const data = await request<CachedRoomDetail>(`/api/rooms/${roomId}`)
    saveRoomScopedCache('finlit_cache_room', roomId, data)
    if (data?.room?._id) saveRoomScopedCache('finlit_cache_room', data.room._id, data)
    if (data?.room?.publicId) saveRoomScopedCache('finlit_cache_room', data.room.publicId, data)
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getRoomScopedCache<CachedRoomDetail>('finlit_cache_room', roomId)
      if (cached) return cached
    }
    throw err
  }
}

// Expenses
export async function listExpenses(roomId: string) {
  try {
    const data = await request<{ expenses: ApiExpense[]; total: number }>(`/api/rooms/${roomId}/expenses`)

    // Reconcile with pending offline queue to avoid duplicate entries once synced
    const queue = getOfflineQueue()
    const pendingExpenses = queue.filter(
      (a): a is OfflineAction & { type: 'create_expense' } =>
        a.type === 'create_expense' && (a.roomId === roomId || roomId.includes(a.roomId))
    )
    const pendingTempIds = new Set(pendingExpenses.map((a) => a.tempId))

    // Only retain offline temporary expenses that are STILL pending in the sync queue
    const cached = getRoomScopedCache<{ expenses: ApiExpense[]; total: number }>('finlit_cache_expenses', roomId)
    const unsyncedOffline = (cached?.expenses || []).filter(
      (e) => e._id.startsWith('offline_exp_') && pendingTempIds.has(e._id)
    )

    const serverIds = new Set(data.expenses.map((e) => e._id))
    const mergedExpenses = [
      ...unsyncedOffline.filter((e) => !serverIds.has(e._id)),
      ...data.expenses,
    ]

    const finalData = {
      expenses: mergedExpenses,
      total: mergedExpenses.length,
    }

    saveRoomScopedCache('finlit_cache_expenses', roomId, finalData)
    return finalData
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getRoomScopedCache<{ expenses: ApiExpense[]; total: number }>('finlit_cache_expenses', roomId)
      if (cached) return cached
    }
    throw err
  }
}

export async function createExpense(roomId: string, draft: ExpenseDraft): Promise<{ expense: ApiExpense }> {
  // If explicitly offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const optimistic = createOptimisticExpense(roomId, draft)
    enqueueOfflineAction({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'create_expense',
      roomId,
      draft,
      tempId: optimistic._id,
      timestamp: Date.now(),
    })
    return { expense: optimistic }
  }

  try {
    const data = await request<{ expense: ApiExpense }>(`/api/rooms/${roomId}/expenses`, {
      method: 'POST',
      body: JSON.stringify({ ...draft, splitMethod: 'equal' }),
    })
    // Update local cache without duplicates
    const cached = getRoomScopedCache<{ expenses: ApiExpense[]; total: number }>('finlit_cache_expenses', roomId)
    if (cached) {
      const filtered = cached.expenses.filter((e) => e._id !== data.expense._id)
      saveRoomScopedCache('finlit_cache_expenses', roomId, {
        expenses: [data.expense, ...filtered],
        total: filtered.length + 1,
      })
    }
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const optimistic = createOptimisticExpense(roomId, draft)
      enqueueOfflineAction({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'create_expense',
        roomId,
        draft,
        tempId: optimistic._id,
        timestamp: Date.now(),
      })
      return { expense: optimistic }
    }
    throw err
  }
}

export async function recordPayment(
  roomId: string,
  toUserId: string,
  amountPaise: number
): Promise<{ payment: unknown }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const optimistic = createOptimisticPayment(roomId, toUserId, amountPaise)
    enqueueOfflineAction({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'record_payment',
      roomId,
      toUserId,
      amountPaise,
      tempId: optimistic._id,
      timestamp: Date.now(),
    })
    return { payment: optimistic }
  }

  try {
    const data = await request<{ payment: unknown }>(`/api/rooms/${roomId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ toUserId, amountPaise }),
    })
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const optimistic = createOptimisticPayment(roomId, toUserId, amountPaise)
      enqueueOfflineAction({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'record_payment',
        roomId,
        toUserId,
        amountPaise,
        tempId: optimistic._id,
        timestamp: Date.now(),
      })
      return { payment: optimistic }
    }
    throw err
  }
}

export function leaveRoom(roomId: string) {
  return request<{ membership: unknown; requiresApproval?: boolean; dissolved?: boolean }>(`/api/rooms/${roomId}/leave`, {
    method: 'POST',
  })
}

// Balances & Activities & Summaries
export async function getBalances(roomId: string) {
  try {
    const data = await request<CachedBalances>(`/api/rooms/${roomId}/balances`)

    const queue = getOfflineQueue()
    const pendingPaymentActions = queue.filter(
      (a): a is OfflineAction & { type: 'record_payment' } =>
        a.type === 'record_payment' && (a.roomId === roomId || roomId.includes(a.roomId))
    )
    const pendingTempIds = new Set(pendingPaymentActions.map((a) => a.tempId))

    const cached = getRoomScopedCache<CachedBalances>('finlit_cache_balances', roomId)
    const unsyncedOfflinePayments = (cached?.pendingPayments || []).filter(
      (p) => p._id.startsWith('offline_pay_') && pendingTempIds.has(p._id)
    )

    const serverPaymentIds = new Set((data.pendingPayments || []).map((p) => p._id))
    const mergedPending = [
      ...unsyncedOfflinePayments.filter((p) => !serverPaymentIds.has(p._id)),
      ...(data.pendingPayments || []),
    ]

    const finalBalances = {
      ...data,
      pendingPayments: mergedPending,
    }

    saveRoomScopedCache('finlit_cache_balances', roomId, finalBalances)
    return finalBalances
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getRoomScopedCache<CachedBalances>('finlit_cache_balances', roomId)
      if (cached) return cached
    }
    throw err
  }
}

export async function getActivity(roomId: string) {
  try {
    const data = await request<{ events: ApiActivity[] }>(`/api/rooms/${roomId}/activity`)
    saveRoomScopedCache('finlit_cache_activity', roomId, data)
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getRoomScopedCache<{ events: ApiActivity[] }>('finlit_cache_activity', roomId)
      if (cached) return cached
    }
    throw err
  }
}

export async function getSummary(roomId: string) {
  try {
    const data = await request<ApiSummary>(`/api/rooms/${roomId}/summary`)
    saveRoomScopedCache('finlit_cache_summary', roomId, data)
    return data
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      const cached = getRoomScopedCache<ApiSummary>('finlit_cache_summary', roomId)
      if (cached) return cached
    }
    throw err
  }
}

export function getExpenseHistory(expenseId: string) {
  return request<{ history: ApiActivity[] }>(`/api/expenses/${expenseId}/history`)
}

export async function updateExpense(expenseId: string, draft: Partial<ExpenseDraft>) {
  try {
    return await request<{ expense: ApiExpense }>(`/api/expenses/${expenseId}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    })
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      enqueueOfflineAction({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'update_expense',
        expenseId,
        draft,
        timestamp: Date.now(),
      })
      return {
        expense: {
          _id: expenseId,
          description: draft.description || 'Updated expense',
          amountPaise: draft.amountPaise || 0,
          expenseDate: new Date().toISOString(),
          payerId: draft.payerId || '',
          createdBy: draft.payerId || '',
          participants: draft.participantIds || [],
          isEdited: true,
        },
      }
    }
    throw err
  }
}

export async function voidExpense(expenseId: string) {
  try {
    return await request<{ expense: ApiExpense; voided: boolean; pendingApproval?: boolean; message?: string }>(
      `/api/expenses/${expenseId}/void`,
      { method: 'POST' }
    )
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      enqueueOfflineAction({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'void_expense',
        expenseId,
        timestamp: Date.now(),
      })
      return {
        expense: {
          _id: expenseId,
          description: 'Voided expense',
          amountPaise: 0,
          expenseDate: new Date().toISOString(),
          payerId: '',
          createdBy: '',
          voidedAt: new Date().toISOString(),
        },
        voided: true,
        message: 'Expense marked void offline. Will sync when back online.',
      }
    }
    throw err
  }
}

export async function decideVoidRequest(expenseId: string, decision: 'approve' | 'reject') {
  try {
    return await request<{ expense: ApiExpense; voided: boolean; message: string }>(
      `/api/expenses/${expenseId}/decide-void`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }
    )
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      enqueueOfflineAction({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'decide_void',
        expenseId,
        decision,
        timestamp: Date.now(),
      })
      return {
        expense: {
          _id: expenseId,
          description: 'Expense',
          amountPaise: 0,
          expenseDate: new Date().toISOString(),
          payerId: '',
          createdBy: '',
        },
        voided: decision === 'approve',
        message: 'Void decision saved offline.',
      }
    }
    throw err
  }
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

export async function decidePayment(roomId: string, paymentId: string, action: 'approve' | 'reject') {
  try {
    return await request<{ payment: ApiPendingPayment }>(`/api/rooms/${roomId}/payments/${paymentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    })
  } catch (err) {
    if (isOfflineOrNetworkError(err)) {
      enqueueOfflineAction({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'decide_payment',
        roomId,
        paymentId,
        action,
        timestamp: Date.now(),
      })
      return {
        payment: {
          _id: paymentId,
          fromUserId: '',
          toUserId: '',
          amountPaise: 0,
          paymentDate: new Date().toISOString(),
          status: action === 'approve' ? 'completed' : 'rejected',
        },
      }
    }
    throw err
  }
}

export async function joinRoom(roomId: string) {
  const data = await request<{
    membership: ApiRoomMembership
    token?: string
    user?: { id: string; displayName: string }
    reclaimed?: boolean
  }>(`/api/rooms/join`, {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  })
  if (data.token) {
    setStoredToken(data.token)
  }
  if (data.user) {
    setCached('finlit_cache_user', data.user)
  }
  return data
}

export const apiIsConfigured = true

// Sync Executor
async function executeOfflineAction(action: OfflineAction): Promise<boolean> {
  switch (action.type) {
    case 'create_expense': {
      const res = await request<{ expense: ApiExpense }>(`/api/rooms/${action.roomId}/expenses`, {
        method: 'POST',
        body: JSON.stringify({ ...action.draft, splitMethod: 'equal' }),
      })
      // Clean up temporary offline expense from cache and replace with synced server expense
      const cached = getRoomScopedCache<{ expenses: ApiExpense[]; total: number }>('finlit_cache_expenses', action.roomId)
      if (cached) {
        const withoutTemp = cached.expenses.filter((e) => e._id !== action.tempId && e._id !== res.expense._id)
        saveRoomScopedCache('finlit_cache_expenses', action.roomId, {
          expenses: [res.expense, ...withoutTemp],
          total: withoutTemp.length + 1,
        })
      }
      return true
    }
    case 'record_payment': {
      await request<{ payment: unknown }>(`/api/rooms/${action.roomId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ toUserId: action.toUserId, amountPaise: action.amountPaise }),
      })
      const cached = getRoomScopedCache<CachedBalances>('finlit_cache_balances', action.roomId)
      if (cached && cached.pendingPayments) {
        cached.pendingPayments = cached.pendingPayments.filter((p) => p._id !== action.tempId)
        saveRoomScopedCache('finlit_cache_balances', action.roomId, cached)
      }
      return true
    }
    case 'update_expense': {
      await request<{ expense: ApiExpense }>(`/api/expenses/${action.expenseId}`, {
        method: 'PATCH',
        body: JSON.stringify(action.draft),
      })
      return true
    }
    case 'void_expense': {
      await request(`/api/expenses/${action.expenseId}/void`, { method: 'POST' })
      return true
    }
    case 'decide_void': {
      await request(`/api/expenses/${action.expenseId}/decide-void`, {
        method: 'POST',
        body: JSON.stringify({ decision: action.decision }),
      })
      return true
    }
    case 'decide_payment': {
      await request(`/api/rooms/${action.roomId}/payments/${action.paymentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: action.action }),
      })
      return true
    }
    default:
      return true
  }
}

export function triggerOfflineSync(): Promise<{ processed: number; remaining: number }> {
  return processOfflineSync(executeOfflineAction)
}

// Background event listeners for auto-sync
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void triggerOfflineSync()
  })

  // Also check sync periodically or when page becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void triggerOfflineSync()
    }
  })

  setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void triggerOfflineSync()
    }
  }, 20000)
}
