import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import { z } from 'zod'
import { Expense } from '../models/Expense.js'
import { Membership } from '../models/Membership.js'
import { AuditEvent } from '../models/AuditEvent.js'
import { requireAuth } from '../middleware/auth.js'
import { getRoomForMember } from '../middleware/roomAccess.js'
import { splitEqual, splitPercentage, validateAllocations } from '../services/balanceService.js'
import { asyncHandler, HttpError, ok } from '../utils/http.js'

const router = Router()
const expenseInput = z.object({
  description: z.string().trim().max(160).optional(),
  amountPaise: z.number().int().positive(),
  payerId: z.string(),
  participantIds: z.array(z.string()).min(1),
  splitMethod: z.enum(['equal', 'custom', 'percentage']).default('equal'),
  allocations: z.array(z.object({ userId: z.string(), amountPaise: z.number().int().nonnegative().optional(), percentage: z.number().min(0).max(100).optional() })).optional(),
  expenseDate: z.coerce.date().default(() => new Date()),
})

async function activeMemberIds(roomId: string) {
  return (await Membership.find({ roomId, status: 'active' }).select('userId')).map((membership) => membership.userId.toString())
}
function ensureMembers(ids: string[], allowed: string[]) { if (ids.some((id) => !isValidObjectId(id) || !allowed.includes(id))) throw new HttpError(400, 'INVALID_PARTICIPANT', 'Every participant must be an active room member.') }

router.use(requireAuth)
router.post('/rooms/:roomId/expenses', getRoomForMember, asyncHandler(async (req, res) => {
  const input = expenseInput.safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_EXPENSE', 'Please check the expense amount and participants.')
  const room = res.locals.room
  const allowed = await activeMemberIds(room._id.toString())
  ensureMembers([input.data.payerId, ...input.data.participantIds], allowed)
  const method = input.data.splitMethod
  let allocations = input.data.allocations ?? []
  if (method === 'equal') allocations = splitEqual(input.data.amountPaise, input.data.participantIds)
  if (method === 'percentage') allocations = splitPercentage(input.data.amountPaise, allocations)
  validateAllocations(input.data.amountPaise, allocations, method)
  const expense = await Expense.create({ roomId: room._id, description: input.data.description || 'Shared expense', amountPaise: input.data.amountPaise, payerId: input.data.payerId, participants: input.data.participantIds, allocations, splitMethod: method, expenseDate: input.data.expenseDate, createdBy: req.userId })
  await AuditEvent.create({ roomId: room._id, entityType: 'expense', entityId: expense._id, action: 'expense.created', actorId: req.userId, newValues: expense.toObject() })
  ok(res, { expense }, 201)
}))

router.get('/rooms/:roomId/expenses', getRoomForMember, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1))
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)))
  const filter = { roomId: res.locals.room._id, ...(req.query.from ? { expenseDate: { $gte: new Date(String(req.query.from)) } } : {}) }
  const [expenses, total] = await Promise.all([Expense.find(filter).sort({ expenseDate: -1 }).skip((page - 1) * limit).limit(limit).populate('payerId createdBy', 'displayName'), Expense.countDocuments(filter)])
  ok(res, { expenses, page, limit, total })
}))

router.get('/expenses/:expenseId', asyncHandler(async (req, res, next) => {
  if (!req.userId) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.'))
  const expense = await Expense.findById(req.params.expenseId).populate('payerId createdBy', 'displayName')
  if (!expense) throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'This expense could not be found.')
  const membership = await Membership.findOne({ roomId: expense.roomId, userId: req.userId, status: 'active' })
  if (!membership) throw new HttpError(403, 'ROOM_ACCESS_DENIED', 'You do not have access to this expense.')
  ok(res, { expense })
}))

router.get('/expenses/:expenseId/history', asyncHandler(async (req, res, next) => {
  if (!req.userId) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.'))
  const expense = await Expense.findById(req.params.expenseId).select('roomId')
  if (!expense) throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'This expense could not be found.')
  const membership = await Membership.findOne({ roomId: expense.roomId, userId: req.userId, status: 'active' })
  if (!membership) throw new HttpError(403, 'ROOM_ACCESS_DENIED', 'You do not have access to this expense.')
  const history = await AuditEvent.find({ entityType: 'expense', entityId: expense._id }).sort({ createdAt: -1 }).populate('actorId', 'displayName')
  ok(res, { history })
}))

router.patch('/expenses/:expenseId', asyncHandler(async (req, res, next) => {
  if (!req.userId) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.'))
  const expense = await Expense.findById(req.params.expenseId)
  if (!expense) throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'This expense could not be found.')
  const membership = await Membership.findOne({ roomId: expense.roomId, userId: req.userId, status: 'active' })
  if (!membership || (membership.role !== 'admin' && expense.createdBy.toString() !== req.userId)) throw new HttpError(403, 'EXPENSE_EDIT_DENIED', 'You do not have permission to edit this expense.')
  const input = expenseInput.partial().safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_EXPENSE', 'Please check the updated expense.')
  const previous = expense.toObject()
  if (input.data.description !== undefined) expense.description = input.data.description || 'Shared expense'
  if (input.data.expenseDate !== undefined) expense.expenseDate = input.data.expenseDate
  if (input.data.amountPaise !== undefined || input.data.participantIds !== undefined || input.data.allocations !== undefined || input.data.splitMethod !== undefined) {
    const amount = input.data.amountPaise ?? expense.amountPaise
    const participantIds = input.data.participantIds ?? expense.participants.map(String)
    const method = input.data.splitMethod ?? expense.splitMethod
    let allocations = input.data.allocations ?? expense.allocations.map((allocation) => ({ userId: allocation.userId.toString(), amountPaise: allocation.amountPaise, percentage: allocation.percentage ?? undefined }))
    if (method === 'equal') allocations = splitEqual(amount, participantIds)
    if (method === 'percentage') allocations = splitPercentage(amount, allocations)
    validateAllocations(amount, allocations, method)
    expense.amountPaise = amount; expense.participants = participantIds as never; expense.allocations = allocations as never; expense.splitMethod = method
  }
  await expense.save()
  await AuditEvent.create({ roomId: expense.roomId, entityType: 'expense', entityId: expense._id, action: 'expense.updated', actorId: req.userId, previousValues: previous, newValues: expense.toObject() })
  ok(res, { expense })
}))

router.post('/expenses/:expenseId/void', asyncHandler(async (req, res, next) => {
  if (!req.userId) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.'))
  const expense = await Expense.findById(req.params.expenseId)
  if (!expense) throw new HttpError(404, 'EXPENSE_NOT_FOUND', 'This expense could not be found.')
  const membership = await Membership.findOne({ roomId: expense.roomId, userId: req.userId, status: 'active' })
  if (!membership || (membership.role !== 'admin' && expense.createdBy.toString() !== req.userId)) throw new HttpError(403, 'EXPENSE_VOID_DENIED', 'You do not have permission to void this expense.')
  expense.voidedAt = new Date(); await expense.save()
  await AuditEvent.create({ roomId: expense.roomId, entityType: 'expense', entityId: expense._id, action: 'expense.voided', actorId: req.userId })
  ok(res, { expense })
}))

export default router
