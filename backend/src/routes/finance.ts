import { Router } from 'express'
import { Expense } from '../models/Expense.js'
import { Payment } from '../models/Payment.js'
import { AuditEvent } from '../models/AuditEvent.js'
import { requireAuth } from '../middleware/auth.js'
import { getRoomForMember } from '../middleware/roomAccess.js'
import { calculateNetBalances, simplifyBalances } from '../services/balanceService.js'
import { asyncHandler, ok } from '../utils/http.js'

const router = Router()
router.use(requireAuth)

async function roomFinance(roomId: string) {
  const [expenses, payments] = await Promise.all([Expense.find({ roomId }), Payment.find({ roomId })])
  const normalizedExpenses = expenses.map((expense) => ({ payerId: expense.payerId.toString(), amountPaise: expense.amountPaise, allocations: expense.allocations.map((allocation) => ({ userId: allocation.userId.toString(), amountPaise: allocation.amountPaise })), voided: Boolean(expense.voidedAt) }))
  const normalizedPayments = payments.map((payment) => ({ fromUserId: payment.fromUserId.toString(), toUserId: payment.toUserId.toString(), amountPaise: payment.amountPaise }))
  const balances = calculateNetBalances(normalizedExpenses, normalizedPayments)
  return { expenses, payments, balances, suggestions: simplifyBalances(balances) }
}

router.get('/rooms/:roomId/balances', getRoomForMember, asyncHandler(async (_req, res) => { const finance = await roomFinance(res.locals.room._id.toString()); ok(res, finance) }))
router.get('/rooms/:roomId/suggestions', getRoomForMember, asyncHandler(async (_req, res) => { const finance = await roomFinance(res.locals.room._id.toString()); ok(res, { suggestions: finance.suggestions }) }))
router.get('/rooms/:roomId/activity', getRoomForMember, asyncHandler(async (_req, res) => { const events = await AuditEvent.find({ roomId: res.locals.room._id }).sort({ createdAt: -1 }).limit(100).populate('actorId', 'displayName'); ok(res, { events }) }))
router.get('/rooms/:roomId/summary', getRoomForMember, asyncHandler(async (req, res) => {
  const finance = await roomFinance(res.locals.room._id.toString())
  const month = String(req.query.month ?? new Date().toISOString().slice(0, 7))
  const start = new Date(`${month}-01T00:00:00.000Z`); const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1)
  const expenses = finance.expenses.filter((expense) => expense.expenseDate >= start && expense.expenseDate < end && !expense.voidedAt)
  const userId = req.userId
  const paidPaise = expenses.filter((expense) => expense.payerId.toString() === userId).reduce((sum, expense) => sum + expense.amountPaise, 0)
  const sharePaise = expenses.reduce((sum, expense) => sum + (expense.allocations.find((allocation) => allocation.userId.toString() === userId)?.amountPaise ?? 0), 0)
  ok(res, { month, roomSpentPaise: expenses.reduce((sum, expense) => sum + expense.amountPaise, 0), youPaidPaise: paidPaise, yourSharePaise: sharePaise, paidForOthersPaise: paidPaise - sharePaise })
}))

export default router
