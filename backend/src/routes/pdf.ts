import { Router } from 'express'
import PDFDocument from 'pdfkit'
import { Expense } from '../models/Expense.js'
import { Payment } from '../models/Payment.js'
import { requireAuth } from '../middleware/auth.js'
import { getRoomForMember } from '../middleware/roomAccess.js'
import { asyncHandler } from '../utils/http.js'

const router = Router()
router.get('/rooms/:roomId/summary.pdf', requireAuth, getRoomForMember, asyncHandler(async (_req, res) => {
  const room = res.locals.room
  const [expenses, payments] = await Promise.all([Expense.find({ roomId: room._id, voidedAt: null }).sort({ expenseDate: -1 }).populate('payerId', 'displayName'), Payment.find({ roomId: room._id }).sort({ paymentDate: -1 }).populate('fromUserId toUserId', 'displayName')])
  const document = new PDFDocument({ margin: 48 })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${room.publicId}-summary.pdf"`)
  document.pipe(res)
  document.fontSize(22).text(room.name)
  document.fontSize(11).fillColor('#666').text(`Room ${room.publicId} · Generated ${new Date().toLocaleDateString('en-IN')}`)
  document.moveDown().fillColor('#222').fontSize(15).text('Expenses')
  for (const expense of expenses) document.fontSize(11).text(`${expense.description} · Rs. ${(expense.amountPaise / 100).toLocaleString('en-IN')} · Paid by ${typeof expense.payerId === 'object' && 'displayName' in expense.payerId ? expense.payerId.displayName : 'roommate'}`)
  document.moveDown().fontSize(15).text('Recorded payments')
  for (const payment of payments) document.fontSize(11).text(`Rs. ${(payment.amountPaise / 100).toLocaleString('en-IN')} recorded on ${payment.paymentDate.toLocaleDateString('en-IN')}`)
  document.end()
}))

export default router
