import { model, Schema } from 'mongoose'

const paymentSchema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amountPaise: { type: Number, required: true, min: 1 },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  paymentDate: { type: Date, required: true },
}, { timestamps: true })
paymentSchema.index({ roomId: 1, paymentDate: -1 })

export const Payment = model('Payment', paymentSchema)
