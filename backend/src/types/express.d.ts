import type { Request } from 'express'

declare global {
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

export type AuthenticatedRequest = Request & { userId: string }
