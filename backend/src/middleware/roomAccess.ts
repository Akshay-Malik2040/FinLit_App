import type { NextFunction, Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { Membership } from '../models/Membership.js'
import { Room } from '../models/Room.js'
import { HttpError } from '../utils/http.js'

export function buildRoomQuery(identifier: string) {
  const trimmed = identifier.trim()
  const upper = trimmed.toUpperCase()
  const orConditions: Array<Record<string, unknown>> = [
    { publicId: upper },
    { publicId: trimmed },
    { joinCode: upper },
    { joinCode: trimmed },
    { code: upper },
    { code: trimmed },
  ]
  if (isValidObjectId(trimmed)) {
    orConditions.push({ _id: trimmed })
  }
  return {
    $or: orConditions,
    status: { $ne: 'archived' },
  }
}

export async function findRoomByIdentifier(identifier: string) {
  const query = buildRoomQuery(identifier)
  const room = await Room.findOne(query)
  if (room && !room.publicId) {
    room.publicId = (room as any).joinCode || (room as any).code || room._id.toString()
  }
  return room
}

export async function getRoomForMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.')
    const rawRoomId = req.params.roomId
    const roomId = typeof rawRoomId === 'string' ? rawRoomId.trim() : (Array.isArray(rawRoomId) ? rawRoomId[0].trim() : '')
    if (!roomId) throw new HttpError(400, 'INVALID_ROOM_ID', 'Room ID is required.')

    const room = await findRoomByIdentifier(roomId)
    if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'This room could not be found.')

    const membership = await Membership.findOne({ roomId: room._id, userId: req.userId, status: 'active' })
    if (!membership) throw new HttpError(403, 'ROOM_ACCESS_DENIED', 'You do not have access to this room.')

    res.locals.room = room
    res.locals.membership = membership
    next()
  } catch (error) {
    next(error)
  }
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.membership?.role !== 'admin') {
    return next(new HttpError(403, 'ADMIN_REQUIRED', 'Only the room admin can do that.'))
  }
  next()
}
