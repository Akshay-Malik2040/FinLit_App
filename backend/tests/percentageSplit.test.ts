import { describe, expect, it } from 'vitest'
import { splitPercentage } from '../src/services/balanceService.js'

describe('percentage splits', () => {
  it('converts percentages to paise without losing money', () => {
    const allocations = splitPercentage(10001, [{ userId: 'a', percentage: 50 }, { userId: 'b', percentage: 50 }])
    expect(allocations.map((item) => item.amountPaise)).toEqual([5001, 5000])
    expect(allocations.reduce((sum, item) => sum + item.amountPaise, 0)).toBe(10001)
  })
})
