import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { Room } from '../models/Room.js'
import { Membership } from '../models/Membership.js'
import { AuditEvent } from '../models/AuditEvent.js'
import { requireAuth } from '../middleware/auth.js'
import { getRoomForMember, requireAdmin } from '../middleware/roomAccess.js'
import { asyncHandler, HttpError, ok } from '../utils/http.js'

const router = Router()
const roomSchema = z.object({ name: z.string().trim().min(1).max(100), recoveryPassword: z.string().min(8).max(200).optional() })
const roomCode = () => randomBytes(4).toString('hex').toUpperCase()

router.use(requireAuth)
router.get('/', asyncHandler(async (req, res) => {
  const memberships = await Membership.find({ userId: req.userId, status: { $in: ['active', 'left', 'pending'] } }).populate('roomId')
  ok(res, { rooms: memberships })
}))

router.post('/', asyncHandler(async (req, res) => {
  const input = roomSchema.safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_ROOM', 'Please provide a room name and a valid recovery password.')
  let publicId = roomCode()
  while (await Room.exists({ publicId })) publicId = roomCode()
  const recoveryPasswordHash = input.data.recoveryPassword ? await bcrypt.hash(input.data.recoveryPassword, 12) : undefined
  const room = await Room.create({ publicId, name: input.data.name, createdBy: req.userId, adminId: req.userId, recoveryPasswordHash })
  const membership = await Membership.create({ roomId: room._id, userId: req.userId, role: 'admin', status: 'active', joinedAt: new Date() })
  await AuditEvent.create({ roomId: room._id, entityType: 'room', entityId: room._id, action: 'room.created', actorId: req.userId })
  await AuditEvent.create({ roomId: room._id, entityType: 'membership', entityId: membership._id, action: 'membership.created_admin', actorId: req.userId })
  ok(res, { room }, 201)
}))

router.post('/join', asyncHandler(async (req, res) => {
  const input = z.object({ roomId: z.string().trim().min(4) }).safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_ROOM_ID', 'Please enter a valid Room ID.')
  const room = await Room.findOne({ publicId: input.data.roomId.toUpperCase(), status: 'active' })
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'This room could not be found.')
  const existing = await Membership.findOne({ roomId: room._id, userId: req.userId })
  if (existing) {
    if (existing.status === 'left') {
      existing.status = 'pending'
      existing.leftAt = undefined
      await existing.save()
      await AuditEvent.create({ roomId: room._id, entityType: 'membership', entityId: existing._id, action: 'membership.requested', actorId: req.userId })
      return ok(res, { membership: existing })
    }
    return ok(res, { membership: existing })
  }
  const membership = await Membership.create({ roomId: room._id, userId: req.userId, status: 'pending', role: 'member' })
  await AuditEvent.create({ roomId: room._id, entityType: 'membership', entityId: membership._id, action: 'membership.requested', actorId: req.userId })
  ok(res, { membership }, 201)
}))

router.get('/:roomId', getRoomForMember, asyncHandler(async (_req, res) => {
  const room = res.locals.room
  const memberships = await Membership.find({ roomId: room._id, status: { $in: ['active', 'left'] } }).populate('userId', 'displayName')
  ok(res, { room, members: memberships })
}))

router.get('/:roomId/requests', getRoomForMember, requireAdmin, asyncHandler(async (_req, res) => {
  const requests = await Membership.find({ roomId: res.locals.room._id, status: 'pending' }).populate('userId', 'displayName')
  ok(res, { requests })
}))

router.patch('/:roomId/requests/:membershipId', getRoomForMember, requireAdmin, asyncHandler(async (req, res) => {
  const action = z.object({ action: z.enum(['approve', 'reject']) }).safeParse(req.body)
  if (!action.success) throw new HttpError(400, 'INVALID_REQUEST_ACTION', 'That join request action is not valid.')
  const membership = await Membership.findOne({ _id: req.params.membershipId, roomId: res.locals.room._id, status: 'pending' })
  if (!membership) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'This join request could not be found.')
  if (action.data.action === 'approve') {
    membership.status = 'active'
    membership.joinedAt = new Date()
    await membership.save()
  } else {
    await membership.deleteOne()
  }
  await AuditEvent.create({ roomId: res.locals.room._id, entityType: 'membership', entityId: membership._id, action: `membership.${action.data.action}`, actorId: req.userId })
  ok(res, { membership })
}))

router.post('/:roomId/leave', getRoomForMember, asyncHandler(async (req, res) => {
  const membership = res.locals.membership
  const room = res.locals.room
  if (membership.role === 'admin') {
    const nextMember = await Membership.findOne({ roomId: room._id, userId: { $ne: req.userId }, status: 'active' }).sort({ joinedAt: 1 })
    if (nextMember) {
      nextMember.role = 'admin'
      await nextMember.save()
      room.adminId = nextMember.userId
      await room.save()
    }
  }
  membership.status = 'left'
  membership.leftAt = new Date()
  await membership.save()
  await AuditEvent.create({ roomId: room._id, entityType: 'membership', entityId: membership._id, action: 'membership.left', actorId: req.userId })
  ok(res, { membership })
}))

export default router
