// Offline caching and background synchronization engine for FinLit

import type {
  ApiActivity,
  ApiExpense,
  ApiPendingPayment,
  ApiRoom,
  ApiRoomMembership,
  ApiSummary,
  ExpenseDraft,
} from './api'

export type OfflineAction =
  | {
      id: string
      type: 'create_expense'
      roomId: string
      draft: ExpenseDraft
      tempId: string
      timestamp: number
    }
  | {
      id: string
      type: 'record_payment'
      roomId: string
      toUserId: string
      amountPaise: number
      tempId: string
      timestamp: number
    }
  | {
      id: string
      type: 'update_expense'
      expenseId: string
      draft: Partial<ExpenseDraft>
      timestamp: number
    }
  | {
      id: string
      type: 'void_expense'
      expenseId: string
      timestamp: number
    }
  | {
      id: string
      type: 'decide_payment'
      roomId: string
      paymentId: string
      action: 'approve' | 'reject'
      timestamp: number
    }
  | {
      id: string
      type: 'decide_void'
      expenseId: string
      decision: 'approve' | 'reject'
      timestamp: number
    }

export type CachedRoomDetail = {
  room: ApiRoom
  members: Array<{
    _id: string
    userId: { _id: string; displayName: string }
    role: 'admin' | 'member'
    status: 'active' | 'left'
  }>
}

export type CachedBalances = {
  balances: Array<{ userId: string; amountPaise: number }>
  suggestions: Array<{ fromUserId: string; toUserId: string; amountPaise: number }>
  pendingPayments?: ApiPendingPayment[]
}

const QUEUE_KEY = 'finlit_offline_queue'
const ACTIVE_ROOM_KEY = 'finlit_active_room_id'

export function getStoredActiveRoomId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ROOM_KEY)
  } catch {
    return null
  }
}

export function setStoredActiveRoomId(roomId: string | null): void {
  try {
    if (roomId) localStorage.setItem(ACTIVE_ROOM_KEY, roomId)
    else localStorage.removeItem(ACTIVE_ROOM_KEY)
  } catch {
    // ignore
  }
}

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function setCached<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ignore storage quota errors
  }
}

export function removeCached(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

// Canonical room resolution for robust multi-key matching (publicId, _id, joinCode)
export function getCanonicalRoomKey(roomId: string): string {
  if (!roomId) return ''
  // 1. Direct room cache lookup
  const direct = getCached<CachedRoomDetail>(`finlit_cache_room_${roomId}`)
  if (direct?.room?.publicId) return direct.room.publicId
  if (direct?.room?._id) return direct.room._id

  // 2. Lookup in cached user memberships
  const userRooms = getCached<ApiRoomMembership[]>('finlit_cache_rooms') || []
  const found = userRooms.find(
    (r) =>
      r.roomId?.publicId === roomId ||
      r.roomId?._id === roomId ||
      (r.roomId as unknown as { joinCode?: string })?.joinCode === roomId
  )
  if (found?.roomId?.publicId) return found.roomId.publicId
  if (found?.roomId?._id) return found.roomId._id

  return roomId
}

export function saveRoomScopedCache<T>(prefix: string, roomId: string, data: T): void {
  const canonical = getCanonicalRoomKey(roomId)
  setCached(`${prefix}_${roomId}`, data)
  if (canonical && canonical !== roomId) {
    setCached(`${prefix}_${canonical}`, data)
  }
}

export function getRoomScopedCache<T>(prefix: string, roomId: string): T | null {
  const direct = getCached<T>(`${prefix}_${roomId}`)
  if (direct) return direct
  const canonical = getCanonicalRoomKey(roomId)
  if (canonical && canonical !== roomId) {
    return getCached<T>(`${prefix}_${canonical}`)
  }
  return null
}

// Queue methods
export function getOfflineQueue(): OfflineAction[] {
  return getCached<OfflineAction[]>(QUEUE_KEY) || []
}

export function saveOfflineQueue(queue: OfflineAction[]): void {
  setCached(QUEUE_KEY, queue)
}

export function enqueueOfflineAction(action: OfflineAction): void {
  const queue = getOfflineQueue()
  queue.push(action)
  saveOfflineQueue(queue)
}

export function removeOfflineAction(id: string): void {
  const queue = getOfflineQueue().filter((item) => item.id !== id)
  saveOfflineQueue(queue)
}

export function isOfflineOrNetworkError(err?: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true
  }
  if (!err) return false
  if (typeof err === 'object' && err !== null) {
    const code = 'code' in err ? String((err as { code?: unknown }).code) : ''
    const status = 'status' in err ? Number((err as { status?: unknown }).status) : 0
    if (
      [
        'OFFLINE',
        'NETWORK_ERROR',
        'CONFIG_ERROR',
        'INVALID_RESPONSE',
        'REQUEST_FAILED',
        'SERVICE_UNAVAILABLE',
        'GATEWAY_TIMEOUT',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ERR_NETWORK',
      ].includes(code) ||
      status === 503 ||
      status === 502 ||
      status === 504 ||
      status === 0
    ) {
      return true
    }
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('cannot connect') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('502') ||
    msg.includes('connection refused') ||
    msg.includes('timeout')
  )
}

// Balance and split math for offline updates
export function splitEqualAllocations(
  amountPaise: number,
  participantIds: string[]
): Array<{ userId: string; amountPaise: number }> {
  if (participantIds.length === 0) return []
  const base = Math.floor(amountPaise / participantIds.length)
  let remainder = amountPaise % participantIds.length
  return participantIds.map((userId) => {
    const amount = base + (remainder > 0 ? 1 : 0)
    remainder -= 1
    return { userId, amountPaise: amount }
  })
}

export function calculateLocalBalances(
  expenses: ApiExpense[],
  _pendingPayments?: ApiPendingPayment[]
): {
  balances: Array<{ userId: string; amountPaise: number }>
  suggestions: Array<{ fromUserId: string; toUserId: string; amountPaise: number }>
} {
  const balanceMap = new Map<string, number>()
  const add = (userId: string, paise: number) => balanceMap.set(userId, (balanceMap.get(userId) ?? 0) + paise)

  for (const exp of expenses) {
    if (exp.voidedAt) continue
    const payerId = typeof exp.payerId === 'object' && exp.payerId !== null ? exp.payerId._id : String(exp.payerId)
    add(payerId, exp.amountPaise)
    const allocs =
      exp.allocations && exp.allocations.length > 0
        ? exp.allocations
        : splitEqualAllocations(exp.amountPaise, exp.participants || [])
    for (const alloc of allocs) {
      add(alloc.userId, -alloc.amountPaise)
    }
  }

  // Pending payments do not immediately clear the ledger until confirmed
  const balances = [...balanceMap.entries()]
    .map(([userId, amountPaise]) => ({ userId, amountPaise }))
    .filter((b) => b.amountPaise !== 0)

  // Simplify transfers
  const debtors = balances
    .filter((b) => b.amountPaise < 0)
    .map((b) => ({ userId: b.userId, amountPaise: -b.amountPaise }))
    .sort((a, b) => b.amountPaise - a.amountPaise)
  const creditors = balances
    .filter((b) => b.amountPaise > 0)
    .map((b) => ({ userId: b.userId, amountPaise: b.amountPaise }))
    .sort((a, b) => b.amountPaise - a.amountPaise)
  const suggestions: Array<{ fromUserId: string; toUserId: string; amountPaise: number }> = []

  let d = 0
  let c = 0
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]
    const creditor = creditors[c]
    const transferAmount = Math.min(debtor.amountPaise, creditor.amountPaise)
    if (transferAmount > 0) {
      suggestions.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountPaise: transferAmount })
    }
    debtor.amountPaise -= transferAmount
    creditor.amountPaise -= transferAmount
    if (debtor.amountPaise === 0) d++
    if (creditor.amountPaise === 0) c++
  }

  return { balances, suggestions }
}

// Helper for optimistic expense creation
export function createOptimisticExpense(roomId: string, draft: ExpenseDraft): ApiExpense {
  const tempId = `offline_exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const currentUser = getCached<{ id: string; displayName: string }>('finlit_cache_user')
  const payerName = currentUser?.id === draft.payerId ? currentUser.displayName : 'Roommate'

  const allocations = splitEqualAllocations(draft.amountPaise, draft.participantIds)

  const optimistic: ApiExpense = {
    _id: tempId,
    description: draft.description || 'Shared expense',
    amountPaise: draft.amountPaise,
    expenseDate: new Date().toISOString(),
    payerId: { _id: draft.payerId, displayName: payerName },
    createdBy: { _id: draft.payerId, displayName: payerName },
    participants: draft.participantIds,
    splitMethod: 'equal',
    allocations,
    isEdited: false,
  }

  // 1. Update cached expenses in localStorage
  const cachedExpenses = getRoomScopedCache<{ expenses: ApiExpense[]; total: number }>('finlit_cache_expenses', roomId) || {
    expenses: [],
    total: 0,
  }
  const updatedExpenses = [optimistic, ...cachedExpenses.expenses]
  saveRoomScopedCache('finlit_cache_expenses', roomId, { expenses: updatedExpenses, total: updatedExpenses.length })

  // 2. Recalculate and update cached balances in localStorage
  const currentBalances = getRoomScopedCache<CachedBalances>('finlit_cache_balances', roomId)
  const pendingPayments = currentBalances?.pendingPayments || []
  const { balances, suggestions } = calculateLocalBalances(updatedExpenses, pendingPayments)
  saveRoomScopedCache('finlit_cache_balances', roomId, { balances, suggestions, pendingPayments })

  // 3. Update cached summary in localStorage
  const cachedSummary = getRoomScopedCache<ApiSummary>('finlit_cache_summary', roomId) || {
    month: new Date().toISOString().slice(0, 7),
    roomSpentPaise: 0,
    youPaidPaise: 0,
    yourSharePaise: 0,
    paidForOthersPaise: 0,
  }

  const isCurrentPayer = currentUser?.id === draft.payerId
  const currentAlloc = allocations.find((a) => a.userId === currentUser?.id)?.amountPaise ?? 0
  const updatedSummary: ApiSummary = {
    ...cachedSummary,
    roomSpentPaise: cachedSummary.roomSpentPaise + draft.amountPaise,
    youPaidPaise: cachedSummary.youPaidPaise + (isCurrentPayer ? draft.amountPaise : 0),
    yourSharePaise: cachedSummary.yourSharePaise + currentAlloc,
    paidForOthersPaise:
      cachedSummary.paidForOthersPaise + (isCurrentPayer ? draft.amountPaise - currentAlloc : -currentAlloc),
  }
  saveRoomScopedCache('finlit_cache_summary', roomId, updatedSummary)

  // 4. Update cached activity log in localStorage
  const cachedActivity = getRoomScopedCache<{ events: ApiActivity[] }>('finlit_cache_activity', roomId) || {
    events: [],
  }
  const newActivity: ApiActivity = {
    _id: `offline_act_${Date.now()}`,
    action: 'expense.created',
    createdAt: new Date().toISOString(),
    actorId: { displayName: payerName },
  }
  saveRoomScopedCache('finlit_cache_activity', roomId, { events: [newActivity, ...cachedActivity.events] })

  return optimistic
}

// Helper for optimistic payment creation
export function createOptimisticPayment(
  roomId: string,
  toUserId: string,
  amountPaise: number
): ApiPendingPayment {
  const tempId = `offline_pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const currentUser = getCached<{ id: string; displayName: string }>('finlit_cache_user')
  const roomData = getRoomScopedCache<CachedRoomDetail>('finlit_cache_room', roomId)
  const toMember = roomData?.members.find((m) => m.userId._id === toUserId)

  const optimisticPayment: ApiPendingPayment = {
    _id: tempId,
    fromUserId: currentUser ? { _id: currentUser.id, displayName: currentUser.displayName } : 'You',
    toUserId: toMember ? { _id: toMember.userId._id, displayName: toMember.userId.displayName } : toUserId,
    amountPaise,
    paymentDate: new Date().toISOString(),
    status: 'pending',
    recordedBy: currentUser ? { _id: currentUser.id, displayName: currentUser.displayName } : undefined,
  }

  // Update cached balances pending payments
  const cachedBalances = getRoomScopedCache<CachedBalances>('finlit_cache_balances', roomId)
  if (cachedBalances) {
    const existing = cachedBalances.pendingPayments || []
    cachedBalances.pendingPayments = [optimisticPayment, ...existing]
    saveRoomScopedCache('finlit_cache_balances', roomId, cachedBalances)
  }

  return optimisticPayment
}

let isSyncing = false

export async function processOfflineSync(
  executeAction: (action: OfflineAction) => Promise<boolean>
): Promise<{ processed: number; remaining: number }> {
  if (isSyncing || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { processed: 0, remaining: getOfflineQueue().length }
  }

  const queue = getOfflineQueue()
  if (queue.length === 0) {
    return { processed: 0, remaining: 0 }
  }

  isSyncing = true
  let processed = 0

  try {
    for (const action of queue) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break
      }
      try {
        const success = await executeAction(action)
        if (success) {
          removeOfflineAction(action.id)
          processed++
        }
      } catch (err) {
        console.warn('[OfflineSync] Failed to process action:', action.type, err)
        // If it's a permanent validation/server error (not network), remove to unblock queue
        if (!isOfflineOrNetworkError(err)) {
          removeOfflineAction(action.id)
        } else {
          // Network broke mid-sync, stop loop
          break
        }
      }
    }
  } finally {
    isSyncing = false
  }

  if (processed > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finlit:sync_complete', { detail: { processed } }))
  }

  return { processed, remaining: getOfflineQueue().length }
}
