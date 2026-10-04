import type { Balance, Transfer } from '../types/domain.js'

export function calculateNetBalances(expenses: Array<{ payerId: string; amountPaise: number; allocations: Array<{ userId: string; amountPaise: number }>; voided?: boolean }>, payments: Array<{ fromUserId: string; toUserId: string; amountPaise: number }>): Balance[] {
  const balances = new Map<string, number>()
  const add = (userId: string, amountPaise: number) => balances.set(userId, (balances.get(userId) ?? 0) + amountPaise)

  for (const expense of expenses) {
    if (expense.voided) continue
    add(expense.payerId, expense.amountPaise)
    for (const allocation of expense.allocations) add(allocation.userId, -allocation.amountPaise)
  }
  for (const payment of payments) {
    add(payment.fromUserId, payment.amountPaise)
    add(payment.toUserId, -payment.amountPaise)
  }

  return [...balances.entries()].map(([userId, amountPaise]) => ({ userId, amountPaise })).filter((balance) => balance.amountPaise !== 0)
}

export function simplifyBalances(balances: Balance[]): Transfer[] {
  const debtors = balances.filter((balance) => balance.amountPaise < 0).map((balance) => ({ userId: balance.userId, amountPaise: -balance.amountPaise })).sort((a, b) => b.amountPaise - a.amountPaise)
  const creditors = balances.filter((balance) => balance.amountPaise > 0).map((balance) => ({ userId: balance.userId, amountPaise: balance.amountPaise })).sort((a, b) => b.amountPaise - a.amountPaise)
  const transfers: Transfer[] = []
  let debtorIndex = 0
  let creditorIndex = 0

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]
    const creditor = creditors[creditorIndex]
    const amountPaise = Math.min(debtor.amountPaise, creditor.amountPaise)
    if (amountPaise > 0) transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountPaise })
    debtor.amountPaise -= amountPaise
    creditor.amountPaise -= amountPaise
    if (debtor.amountPaise === 0) debtorIndex += 1
    if (creditor.amountPaise === 0) creditorIndex += 1
  }
  return transfers
}

export function splitEqual(amountPaise: number, participantIds: string[]): Array<{ userId: string; amountPaise: number }> {
  if (participantIds.length === 0) throw new Error('At least one participant is required')
  const base = Math.floor(amountPaise / participantIds.length)
  let remainder = amountPaise % participantIds.length
  return participantIds.map((userId) => {
    const amount = base + (remainder > 0 ? 1 : 0)
    remainder -= 1
    return { userId, amountPaise: amount }
  })
}

export function splitPercentage(amountPaise: number, allocations: Array<{ userId: string; percentage?: number }>) {
  const calculated = allocations.map((allocation) => ({ userId: allocation.userId, amountPaise: Math.floor(amountPaise * (allocation.percentage ?? 0) / 100), percentage: allocation.percentage ?? 0 }))
  let remainder = amountPaise - calculated.reduce((sum, allocation) => sum + allocation.amountPaise, 0)
  return calculated.map((allocation) => {
    const amountPaise = allocation.amountPaise + (remainder > 0 ? 1 : 0)
    remainder -= 1
    return { ...allocation, amountPaise }
  })
}

export function validateAllocations(amountPaise: number, allocations: Array<{ userId: string; amountPaise?: number; percentage?: number }>, method: 'equal' | 'custom' | 'percentage') {
  if (!allocations.length) throw new Error('At least one allocation is required')
  if (method === 'custom') {
    const total = allocations.reduce((sum, allocation) => sum + (allocation.amountPaise ?? 0), 0)
    if (total !== amountPaise) throw new Error('Allocation amounts must equal the expense amount')
  }
  if (method === 'percentage') {
    const total = allocations.reduce((sum, allocation) => sum + (allocation.percentage ?? 0), 0)
    if (total !== 100) throw new Error('Allocation percentages must equal 100')
  }
}
