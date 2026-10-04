import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import { z } from 'zod'
import { Room } from '../models/Room.js'
import { Membership } from '../models/Membership.js'
import { AuditEvent } from '../models/AuditEvent.js'
import { requireAuth } from '../middleware/auth.js'
import { getRoomForMember, requireAdmin } from '../middleware/roomAccess.js'
import { asyncHandler, HttpError, ok } from '../utils/http.js'

const router = Router()
const roomSchema = z.object({
  name: z.string().trim().min(1).max(100),
  recoveryQuestion: z.string().trim().max(100).optional(),
  recoveryPassword: z.string().min(4).max(200).optional(),
})
const roomCode = () => randomBytes(4).toString('hex').toUpperCase()

router.use(requireAuth)

router.get('/', asyncHandler(async (req, res) => {
  const memberships = await Membership.find({
    userId: req.userId,
    status: { $in: ['active', 'left', 'pending'] },
  }).populate('roomId')
  ok(res, { rooms: memberships })
}))

router.post('/', asyncHandler(async (req, res) => {
  const input = roomSchema.safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_ROOM', 'Please provide a valid room name.')
  let publicId = roomCode()
  while (await Room.exists({ publicId })) publicId = roomCode()

  const recoveryPasswordHash = input.data.recoveryPassword
    ? await bcrypt.hash(input.data.recoveryPassword, 12)
    : undefined

  const room = await Room.create({
    publicId,
    name: input.data.name,
    createdBy: req.userId,
    adminId: req.userId,
    recoveryQuestion: input.data.recoveryQuestion,
    recoveryPasswordHash,
  })

  const membership = await Membership.create({
    roomId: room._id,
    userId: req.userId,
    role: 'admin',
    status: 'active',
    joinedAt: new Date(),
  })

  await AuditEvent.create({ roomId: room._id, entityType: 'room', entityId: room._id, action: 'room.created', actorId: req.userId })
  await AuditEvent.create({ roomId: room._id, entityType: 'membership', entityId: membership._id, action: 'membership.created_admin', actorId: req.userId })
  ok(res, { room }, 201)
}))

// Room Recovery Endpoint
router.post('/recover', asyncHandler(async (req, res) => {
  const input = z.object({
    roomId: z.string().trim().min(4),
    recoveryPassword: z.string().min(1),
  }).safeParse(req.body)

  if (!input.success) throw new HttpError(400, 'INVALID_INPUT', 'Please provide room ID and recovery password.')

  const room = await Room.findOne({ publicId: input.data.roomId.toUpperCase() }).select('+recoveryPasswordHash')
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'This room could not be found.')

  if (!room.recoveryPasswordHash) {
    throw new HttpError(400, 'NO_RECOVERY_KEY', 'No recovery password was configured for this room.')
  }

  const isValid = await bcrypt.compare(input.data.recoveryPassword, room.recoveryPasswordHash)
  if (!isValid) throw new HttpError(400, 'INVALID_RECOVERY_KEY', 'Incorrect recovery password or answer.')

  // Reactivate room if archived
  if (room.status === 'archived') {
    room.status = 'active'
  }
  room.adminId = req.userId as never
  await room.save()

  // Make user active admin in room
  let membership = await Membership.findOne({ roomId: room._id, userId: req.userId })
  if (membership) {
    membership.role = 'admin'
    membership.status = 'active'
    membership.leftAt = undefined
    await membership.save()
  } else {
    membership = await Membership.create({
      roomId: room._id,
      userId: req.userId,
      role: 'admin',
      status: 'active',
      joinedAt: new Date(),
    })
  }

  await AuditEvent.create({
    roomId: room._id,
    entityType: 'room',
    entityId: room._id,
    action: 'room.recovered',
    actorId: req.userId,
  })

  ok(res, { room, membership })
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

// Admin removes a member from the room
router.delete('/:roomId/members/:membershipId', getRoomForMember, requireAdmin, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.membershipId)) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Member not found.')
  const targetMembership = await Membership.findOne({
    _id: req.params.membershipId,
    roomId: res.locals.room._id,
    status: 'active',
  }).populate('userId', 'displayName')

  if (!targetMembership) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Active member not found in this room.')
  if (targetMembership.userId._id.toString() === req.userId) {
    throw new HttpError(400, 'CANNOT_REMOVE_SELF', 'Admin cannot remove themselves directly. Use leave/dissolve room.')
  }

  targetMembership.status = 'left'
  targetMembership.leftAt = new Date()
  await targetMembership.save()

  await AuditEvent.create({
    roomId: res.locals.room._id,
    entityType: 'membership',
    entityId: targetMembership._id,
    action: 'membership.removed_by_admin',
    actorId: req.userId,
    newValues: { memberName: (targetMembership.userId as { displayName?: string })?.displayName },
  })

  ok(res, { membership: targetMembership })
}))

// Leave room / Dissolve room with members approval
router.post('/:roomId/leave', getRoomForMember, asyncHandler(async (req, res) => {
  const membership = res.locals.membership
  const room = res.locals.room

  // Non-admin can leave directly
  if (membership.role !== 'admin') {
    membership.status = 'left'
    membership.leftAt = new Date()
    await membership.save()
    await AuditEvent.create({ roomId: room._id, entityType: 'membership', entityId: membership._id, action: 'membership.left', actorId: req.userId })
    return ok(res, { membership, dissolved: false })
  }

  // Admin leaving: check if other active members exist
  const otherActiveMembers = await Membership.find({
    roomId: room._id,
    userId: { $ne: req.userId },
    status: 'active',
  })

  // If sole member, archive/dissolve room immediately
  if (otherActiveMembers.length === 0) {
    membership.status = 'left'
    membership.leftAt = new Date()
    await membership.save()
    room.status = 'archived'
    await room.save()
    await AuditEvent.create({ roomId: room._id, entityType: 'room', entityId: room._id, action: 'room.dissolved', actorId: req.userId })
    return ok(res, { membership, dissolved: true })
  }

  // If other members exist, initiate a dissolve request that requires approval
  room.dissolveRequest = {
    requestedBy: req.userId as never,
    requestedAt: new Date(),
    status: 'pending',
    approvals: otherActiveMembers.map((m) => ({
      userId: m.userId,
      approved: false,
    })),
  }
  await room.save()

  await AuditEvent.create({
    roomId: room._id,
    entityType: 'room',
    entityId: room._id,
    action: 'room.dissolve_requested',
    actorId: req.userId,
  })

  ok(res, {
    membership,
    requiresApproval: true,
    dissolveRequest: room.dissolveRequest,
  })
}))

// Member votes to approve/reject room dissolve request
router.post('/:roomId/dissolve/decide', getRoomForMember, asyncHandler(async (req, res) => {
  const room = res.locals.room
  const input = z.object({ action: z.enum(['approve', 'reject']) }).safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_ACTION', 'Action must be approve or reject.')

  if (!room.dissolveRequest || room.dissolveRequest.status !== 'pending') {
    throw new HttpError(400, 'NO_PENDING_DISSOLVE', 'There is no pending dissolve request for this room.')
  }

  const approvalItem = room.dissolveRequest.approvals.find(
    (a: { userId: { toString: () => string } }) => a.userId.toString() === req.userId
  )

  if (!approvalItem) {
    throw new HttpError(403, 'NOT_ELIGIBLE_TO_VOTE', 'You are not on the approval list for this request.')
  }

  if (input.data.action === 'reject') {
    room.dissolveRequest.status = 'rejected'
    await room.save()
    await AuditEvent.create({
      roomId: room._id,
      entityType: 'room',
      entityId: room._id,
      action: 'room.dissolve_rejected',
      actorId: req.userId,
    })
    return ok(res, { room, status: 'rejected' })
  }

  // Approve
  approvalItem.approved = true
  approvalItem.decidedAt = new Date()

  const allApproved = room.dissolveRequest.approvals.every((a: { approved: boolean }) => a.approved)
  if (allApproved) {
    room.dissolveRequest.status = 'approved'
    room.status = 'archived'
    await room.save()

    // Mark all memberships as left
    await Membership.updateMany({ roomId: room._id, status: 'active' }, { status: 'left', leftAt: new Date() })

    await AuditEvent.create({
      roomId: room._id,
      entityType: 'room',
      entityId: room._id,
      action: 'room.dissolved',
      actorId: req.userId,
    })
    return ok(res, { room, status: 'approved', dissolved: true })
  }

  await room.save()
  ok(res, { room, status: 'pending', approvals: room.dissolveRequest.approvals })
}))

export default router
