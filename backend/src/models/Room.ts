import { model, Schema } from 'mongoose'

const roomSchema = new Schema({
  publicId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recoveryPasswordHash: { type: String, select: false },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true })

export const Room = model('Room', roomSchema)
