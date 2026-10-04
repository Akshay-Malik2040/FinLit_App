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
app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    try {
      const url = new URL(origin)
      const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.localhost')
      if (origin === env.CLIENT_URL || isLocalhost) return callback(null, true)
    } catch {
      // fall through to the default rejection below
    }
    callback(new Error(`Origin not allowed by CORS: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }))
app.get('/', (_req, res) => res.json({ success: true, data: { service: 'FinLit API', frontend: env.CLIENT_URL } }))
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
  if (env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test' && normalized.status >= 500) console.error(error)
  res.status(normalized.status).json({ success: false, error: { code: normalized.code, message: normalized.message } })
})
