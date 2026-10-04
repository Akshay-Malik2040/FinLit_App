import { model, Schema } from 'mongoose'

const allocationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amountPaise: { type: Number, required: true, min: 0 },
  percentage: { type: Number, min: 0, max: 100 },
}, { _id: false })

const voidRequestSchema = new Schema({
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
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
  isEdited: { type: Boolean, default: false },
  voidedAt: Date,
  voidRequest: voidRequestSchema,
}, { timestamps: true })
expenseSchema.index({ roomId: 1, updatedAt: -1 })
expenseSchema.index({ roomId: 1, expenseDate: -1 })

export const Expense = model('Expense', expenseSchema)
