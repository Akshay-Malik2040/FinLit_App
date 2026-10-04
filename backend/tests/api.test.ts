import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'
import { calculateNetBalances, simplifyBalances, splitEqual, splitPercentage, validateAllocations } from '../src/services/balanceService.js'

describe('HTTP API basic endpoints', () => {
  it('GET / returns service info', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.service).toBe('FinLit API')
  })

  it('GET /health returns status ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } })
  })

  it('GET /unknown-route returns 404 HttpError', async () => {
    const res = await request(app).get('/unknown-route')
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('POST /api/auth/session with empty name returns 400', async () => {
    const res = await request(app).post('/api/auth/session').send({ displayName: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('INVALID_NAME')
  })

  it('GET /api/auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('POST /api/auth/logout clears cookie and returns ok', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.body.data.loggedOut).toBe(true)
  })
})

describe('Balance Service edge cases', () => {
  it('handles zero balances and skips voided expenses', () => {
    const balances = calculateNetBalances(
      [
        { payerId: 'user1', amountPaise: 1000, allocations: [{ userId: 'user1', amountPaise: 500 }, { userId: 'user2', amountPaise: 500 }], voided: true },
        { payerId: 'user1', amountPaise: 2000, allocations: [{ userId: 'user1', amountPaise: 1000 }, { userId: 'user2', amountPaise: 1000 }] },
      ],
      []
    )
    expect(balances).toEqual([
      { userId: 'user1', amountPaise: 1000 },
      { userId: 'user2', amountPaise: -1000 },
    ])
  })

  it('simplifies 3-way circular debts efficiently', () => {
    // user1 paid 300 for user2
    // user2 paid 300 for user3
    // user3 paid 300 for user1
    // Everyone net 0
    const balances = calculateNetBalances(
      [
        { payerId: 'user1', amountPaise: 300, allocations: [{ userId: 'user2', amountPaise: 300 }] },
        { payerId: 'user2', amountPaise: 300, allocations: [{ userId: 'user3', amountPaise: 300 }] },
        { payerId: 'user3', amountPaise: 300, allocations: [{ userId: 'user1', amountPaise: 300 }] },
      ],
      []
    )
    expect(balances).toEqual([])
    const transfers = simplifyBalances(balances)
    expect(transfers).toEqual([])
  })

  it('splitEqual throws error on empty participant list', () => {
    expect(() => splitEqual(100, [])).toThrow('At least one participant is required')
  })

  it('validateAllocations throws error on empty allocations or invalid sum', () => {
    expect(() => validateAllocations(100, [], 'equal')).toThrow('At least one allocation is required')
    expect(() => validateAllocations(100, [{ userId: 'a', amountPaise: 50 }], 'custom')).toThrow('Allocation amounts must equal the expense amount')
    expect(() => validateAllocations(100, [{ userId: 'a', percentage: 90 }], 'percentage')).toThrow('Allocation percentages must equal 100')
  })

  it('splitPercentage distributes odd remainder paise accurately', () => {
    const allocations = splitPercentage(10, [
      { userId: 'u1', percentage: 33.33 },
      { userId: 'u2', percentage: 33.33 },
      { userId: 'u3', percentage: 33.34 },
    ])
    const total = allocations.reduce((sum, item) => sum + item.amountPaise, 0)
    expect(total).toBe(10)
  })
})
