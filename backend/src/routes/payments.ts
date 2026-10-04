import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
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

router.get('/rooms/:roomId/payments', getRoomForMember, asyncHandler(async (req, res) => {
  const payments = await Payment.find({ roomId: res.locals.room._id })
    .sort({ paymentDate: -1 })
    .limit(100)
    .populate('fromUserId toUserId recordedBy', 'displayName')
  ok(res, { payments })
}))

router.post('/rooms/:roomId/payments', getRoomForMember, asyncHandler(async (req, res) => {
  const input = z.object({
    toUserId: z.string(),
    amountPaise: z.number().int().positive(),
    paymentDate: z.coerce.date().default(() => new Date()),
  }).safeParse(req.body)

  if (!input.success) throw new HttpError(400, 'INVALID_PAYMENT', 'Please enter a valid payment amount and recipient.')
  if (input.data.toUserId === req.userId) throw new HttpError(400, 'INVALID_PAYMENT_RECIPIENT', 'You cannot record a payment to yourself.')

  const members = await Membership.find({ roomId: res.locals.room._id, status: { $in: ['active', 'left'] } }).select('userId')
  if (!members.some((member) => member.userId.toString() === input.data.toUserId)) {
    throw new HttpError(400, 'INVALID_PAYMENT_RECIPIENT', 'That person is not part of this room.')
  }

  const [expenses, completedPayments] = await Promise.all([
    Expense.find({ roomId: res.locals.room._id }),
    Payment.find({ roomId: res.locals.room._id, status: 'completed' }),
  ])

  const balances = calculateNetBalances(
    expenses.map((expense) => ({
      payerId: expense.payerId.toString(),
      amountPaise: expense.amountPaise,
      allocations: expense.allocations.map((allocation) => ({
        userId: allocation.userId.toString(),
        amountPaise: allocation.amountPaise,
      })),
      voided: Boolean(expense.voidedAt),
    })),
    completedPayments.map((payment) => ({
      fromUserId: payment.fromUserId.toString(),
      toUserId: payment.toUserId.toString(),
      amountPaise: payment.amountPaise,
    }))
  )

  const outstanding = balances.find((balance) => balance.userId === req.userId)?.amountPaise ?? 0
  if (input.data.amountPaise > Math.max(0, -outstanding)) {
    throw new HttpError(409, 'PAYMENT_EXCEEDS_BALANCE', 'This payment is more than your current outstanding balance.')
  }

  const payment = await Payment.create({
    roomId: res.locals.room._id,
    fromUserId: req.userId,
    toUserId: input.data.toUserId,
    amountPaise: input.data.amountPaise,
    paymentDate: input.data.paymentDate,
    recordedBy: req.userId,
    status: 'pending',
  })

  await AuditEvent.create({
    roomId: res.locals.room._id,
    entityType: 'payment',
    entityId: payment._id,
    action: 'payment.requested',
    actorId: req.userId,
    newValues: payment.toObject(),
  })

  ok(res, { payment }, 201)
}))

router.patch('/rooms/:roomId/payments/:paymentId', getRoomForMember, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.paymentId)) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment could not be found.')
  const payment = await Payment.findOne({ _id: req.params.paymentId, roomId: res.locals.room._id })
  if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment could not be found.')
  if (payment.status !== 'pending') throw new HttpError(400, 'PAYMENT_ALREADY_DECIDED', `Payment is already ${payment.status}.`)

  const membership = res.locals.membership
  const isReceiver = payment.toUserId.toString() === req.userId
  const isAdmin = membership.role === 'admin'

  if (!isReceiver && !isAdmin) {
    throw new HttpError(403, 'APPROVAL_DENIED', 'Only the payment recipient or room admin can approve or decline this payment.')
  }

  const input = z.object({ action: z.enum(['approve', 'reject']) }).safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_ACTION', 'Action must be approve or reject.')

  if (input.data.action === 'approve') {
    payment.status = 'completed'
    payment.confirmedAt = new Date()
    await payment.save()
    await AuditEvent.create({
      roomId: res.locals.room._id,
      entityType: 'payment',
      entityId: payment._id,
      action: 'payment.confirmed',
      actorId: req.userId,
      newValues: payment.toObject(),
    })
  } else {
    payment.status = 'rejected'
    payment.rejectedAt = new Date()
    await payment.save()
    await AuditEvent.create({
      roomId: res.locals.room._id,
      entityType: 'payment',
      entityId: payment._id,
      action: 'payment.rejected',
      actorId: req.userId,
      newValues: payment.toObject(),
    })
  }

  ok(res, { payment })
}))

export default router
