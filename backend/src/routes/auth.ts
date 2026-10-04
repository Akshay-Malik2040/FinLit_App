import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { env } from '../config/env.js'
import { User } from '../models/User.js'
import { asyncHandler, ok, HttpError } from '../utils/http.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const sessionSchema = z.object({ displayName: z.string().trim().min(1).max(80) })

router.post('/session', asyncHandler(async (req, res) => {
  const input = sessionSchema.safeParse(req.body)
  if (!input.success) throw new HttpError(400, 'INVALID_NAME', 'Please enter a name to continue.')
  const user = await User.create({ displayName: input.data.displayName })
  const token = jwt.sign({}, env.JWT_SECRET, { subject: user.id, expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] })
  res.cookie('session', token, { httpOnly: true, sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax', secure: env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 })
  ok(res, { user: { id: user.id, displayName: user.displayName }, token }, 201)
}))

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId).lean()
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.')
  ok(res, { user: { id: user._id, displayName: user.displayName } })
}))

router.post('/logout', (_req, res) => { res.clearCookie('session'); ok(res, { loggedOut: true }) })
export default router
