import type { NextFunction, Request, Response } from 'express'

export class HttpError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  handler(req, res, next).catch(next)
}

export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data })
