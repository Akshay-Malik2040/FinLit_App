import { Router } from 'express'
import { z } from 'zod'
import { Payment } from '../models/Payment.js'
import { Membership } from '../models/Membership.js'
import { Expense } from '../models/Expense.js'
import { AuditEvent } from '../models/AuditEvent.js'
import { requireAuth } from '../middleware/auth.js'
import { getRoomForMember } from '../middleware/roomAccess.js'
import { calculateNetBalances } from '../services/balanceService.js'
import { asyncHandler, HttpError, ok } from '../utils/http.js'

const router = Router()
router.use(requireAuth)

router.get('/rooms/:roomId/payments', getRoomForMember, asyncHandler(async (_req, res) => {
  const payments = await Payment.find({ roomId: res.locals.room._id }).sort({ paymentDate: -1 }).limit(100).populate('fromUserId toUserId recordedBy', 'displayName')
  ok(res, { payments })
}))

router.post('/rooms/:roomId/payments', getRoomForMember, asyncHandler(async (req, res) => {
  const input = z.object({ toUserId: z.string(), amountPaise: z.number().int().positive(), paymentDate: z.coerce.date().default(() => new Date()) }).safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_PAYMENT', 'Please enter a valid payment amount and recipient.')
  if (input.data.toUserId === req.userId) throw new HttpError(400, 'INVALID_PAYMENT_RECIPIENT', 'You cannot record a payment to yourself.')
  const members = await Membership.find({ roomId: res.locals.room._id, status: { $in: ['active', 'left'] } }).select('userId')
  if (!members.some((member) => member.userId.toString() === input.data.toUserId)) throw new HttpError(400, 'INVALID_PAYMENT_RECIPIENT', 'That person is not part of this room.')
  const [expenses, payments] = await Promise.all([Expense.find({ roomId: res.locals.room._id }), Payment.find({ roomId: res.locals.room._id })])
  const balances = calculateNetBalances(expenses.map((expense) => ({ payerId: expense.payerId.toString(), amountPaise: expense.amountPaise, allocations: expense.allocations.map((allocation) => ({ userId: allocation.userId.toString(), amountPaise: allocation.amountPaise })), voided: Boolean(expense.voidedAt) })), payments.map((payment) => ({ fromUserId: payment.fromUserId.toString(), toUserId: payment.toUserId.toString(), amountPaise: payment.amountPaise })))
  const outstanding = balances.find((balance) => balance.userId === req.userId)?.amountPaise ?? 0
  if (input.data.amountPaise > Math.max(0, -outstanding)) throw new HttpError(409, 'PAYMENT_EXCEEDS_BALANCE', 'This payment is more than your current outstanding balance.')
  const payment = await Payment.create({ roomId: res.locals.room._id, fromUserId: req.userId, toUserId: input.data.toUserId, amountPaise: input.data.amountPaise, paymentDate: input.data.paymentDate, recordedBy: req.userId })
  await AuditEvent.create({ roomId: res.locals.room._id, entityType: 'payment', entityId: payment._id, action: 'payment.created', actorId: req.userId, newValues: payment.toObject() })
  ok(res, { payment }, 201)
}))

export default router
