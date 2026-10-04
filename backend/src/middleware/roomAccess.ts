import type { NextFunction, Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { Membership } from '../models/Membership.js'
import { Room } from '../models/Room.js'
import { HttpError } from '../utils/http.js'

export async function getRoomForMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.')
    const roomId = req.params.roomId
    const room = isValidObjectId(roomId) ? await Room.findById(roomId) : await Room.findOne({ publicId: roomId })
    if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'This room could not be found.')
    const membership = await Membership.findOne({ roomId: room._id, userId: req.userId, status: 'active' })
    if (!membership) throw new HttpError(403, 'ROOM_ACCESS_DENIED', 'You do not have access to this room.')
    res.locals.room = room
    res.locals.membership = membership
    next()
  } catch (error) { next(error) }
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.membership?.role !== 'admin') return next(new HttpError(403, 'ADMIN_REQUIRED', 'Only the room admin can do that.'))
  next()
}
