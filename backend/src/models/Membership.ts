import { model, Schema } from 'mongoose'

const membershipSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  status: { type: String, enum: ['pending', 'active', 'left'], default: 'pending' },
  joinedAt: Date,
  leftAt: Date,
}, { timestamps: true })
membershipSchema.index({ roomId: 1, userId: 1 }, { unique: true })

export const Membership = model('Membership', membershipSchema)
