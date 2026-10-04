import { model, Schema } from 'mongoose'

const allocationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amountPaise: { type: Number, required: true, min: 0 },
  percentage: { type: Number, min: 0, max: 100 },
}, { _id: false })

const expenseSchema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  description: { type: String, required: true, trim: true, maxlength: 160 },
  amountPaise: { type: Number, required: true, min: 1 },
  payerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  allocations: { type: [allocationSchema], required: true },
  splitMethod: { type: String, enum: ['equal', 'custom', 'percentage'], required: true },
  expenseDate: { type: Date, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  voidedAt: Date,
}, { timestamps: true })
expenseSchema.index({ roomId: 1, expenseDate: -1 })

export const Expense = model('Expense', expenseSchema)
