import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { HttpError } from '../utils/http.js'

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization')
  const token = req.cookies?.session ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)
  if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please start a session to continue.'))
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload
    if (!payload.sub) throw new Error('Missing subject')
    req.userId = payload.sub
    next()
  } catch {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired.'))
  }
}
