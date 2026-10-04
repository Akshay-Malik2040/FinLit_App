import { describe, expect, it } from 'vitest'
import { calculateNetBalances, simplifyBalances, splitEqual, validateAllocations } from '../src/services/balanceService.js'

describe('balance service', () => {
  it('splits paise equally and conserves the total', () => {
    const allocations = splitEqual(10000, ['a', 'b', 'c'])
    expect(allocations.map((item) => item.amountPaise)).toEqual([3334, 3333, 3333])
    expect(allocations.reduce((sum, item) => sum + item.amountPaise, 0)).toBe(10000)
  })
  it('validates custom and percentage allocations', () => {
    expect(() => validateAllocations(1000, [{ userId: 'a', amountPaise: 600 }, { userId: 'b', amountPaise: 400 }], 'custom')).not.toThrow()
    expect(() => validateAllocations(1000, [{ userId: 'a', amountPaise: 900 }], 'custom')).toThrow()
    expect(() => validateAllocations(1000, [{ userId: 'a', percentage: 60 }, { userId: 'b', percentage: 40 }], 'percentage')).not.toThrow()
  })
  it('calculates net balances and simplifies transfers', () => {
    const balances = calculateNetBalances([{ payerId: 'a', amountPaise: 1000, allocations: [{ userId: 'a', amountPaise: 250 }, { userId: 'b', amountPaise: 250 }, { userId: 'c', amountPaise: 500 }] }], [])
    const suggestions = simplifyBalances(balances)
    expect(suggestions).toEqual(expect.arrayContaining([{ fromUserId: 'b', toUserId: 'a', amountPaise: 250 }, { fromUserId: 'c', toUserId: 'a', amountPaise: 500 }]))
    expect(suggestions.reduce((sum, transfer) => sum + transfer.amountPaise, 0)).toBe(750)
  })
  it('applies partial payments', () => {
    const balances = calculateNetBalances([{ payerId: 'a', amountPaise: 1000, allocations: [{ userId: 'a', amountPaise: 500 }, { userId: 'b', amountPaise: 500 }] }], [{ fromUserId: 'b', toUserId: 'a', amountPaise: 200 }])
    expect(balances).toEqual([{ userId: 'a', amountPaise: 300 }, { userId: 'b', amountPaise: -300 }])
  })
})
