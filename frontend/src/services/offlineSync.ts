// Offline caching and background synchronization engine for FinLit

import type {
  ApiExpense,
  ApiPendingPayment,
  ApiRoom,
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

export function isOfflineOrNetworkError(err?: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true
  }
  if (!err) return false
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code?: unknown }).code)
    if (['OFFLINE', 'NETWORK_ERROR', 'CONFIG_ERROR', 'INVALID_RESPONSE'].includes(code)) {
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
    msg.includes('rate limit')
  )
}

// Helper for optimistic expense creation
export function createOptimisticExpense(roomId: string, draft: ExpenseDraft): ApiExpense {
  const tempId = `offline_exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const currentUser = getCached<{ id: string; displayName: string }>('finlit_cache_user')
  const payerName = currentUser?.id === draft.payerId ? currentUser.displayName : 'Roommate'

  const optimistic: ApiExpense = {
    _id: tempId,
    description: draft.description || 'Shared expense',
    amountPaise: draft.amountPaise,
    expenseDate: new Date().toISOString(),
    payerId: { _id: draft.payerId, displayName: payerName },
    createdBy: { _id: draft.payerId, displayName: payerName },
    participants: draft.participantIds,
    splitMethod: 'equal',
    allocations: draft.participantIds.map((userId) => ({
      userId,
      amountPaise: Math.round(draft.amountPaise / Math.max(1, draft.participantIds.length)),
    })),
    isEdited: false,
  }

  // Update cached expenses
  const cacheKey = `finlit_cache_expenses_${roomId}`
  const cached = getCached<{ expenses: ApiExpense[]; total: number }>(cacheKey) || { expenses: [], total: 0 }
  const updatedExpenses = [optimistic, ...cached.expenses]
  setCached(cacheKey, { expenses: updatedExpenses, total: updatedExpenses.length })

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
  const roomData = getCached<CachedRoomDetail>(`finlit_cache_room_${roomId}`)
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
  const cacheKey = `finlit_cache_balances_${roomId}`
  const cachedBalances = getCached<CachedBalances>(cacheKey)
  if (cachedBalances) {
    const existing = cachedBalances.pendingPayments || []
    cachedBalances.pendingPayments = [optimisticPayment, ...existing]
    setCached(cacheKey, cachedBalances)
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
