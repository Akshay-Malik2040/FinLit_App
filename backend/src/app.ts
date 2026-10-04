import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import authRoutes from './routes/auth.js'
import roomRoutes from './routes/rooms.js'
import expenseRoutes from './routes/expenses.js'
import paymentRoutes from './routes/payments.js'
import financeRoutes from './routes/finance.js'
import pdfRoutes from './routes/pdf.js'
import { HttpError } from './utils/http.js'

export const app = express()
app.use(helmet())
app.use(cors({ origin: env.CLIENT_URL, credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }))
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }))
app.use('/api/auth', authRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api', expenseRoutes)
app.use('/api', paymentRoutes)
app.use('/api', financeRoutes)
app.use('/api', pdfRoutes)
app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'This endpoint could not be found.')))
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const normalized = error instanceof HttpError ? error : new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
  if (env.NODE_ENV !== 'production') console.error(error)
  res.status(normalized.status).json({ success: false, error: { code: normalized.code, message: normalized.message } })
})
