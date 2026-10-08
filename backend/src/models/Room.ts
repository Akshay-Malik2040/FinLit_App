import { model, Schema, type InferSchemaType } from 'mongoose'

const roomSchema = new Schema(
  {
    publicId: { type: String, required: true, index: true },
    joinCode: { type: String, required: false, index: true },
    code: { type: String, required: false, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recoveryQuestion: { type: String, trim: true },
    recoveryPasswordHash: { type: String, select: false },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    dissolveRequest: {
      requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      requestedAt: { type: Date },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      approvals: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          approved: { type: Boolean, default: false },
          decidedAt: { type: Date },
        },
      ],
    },
  },
  { timestamps: true }
)

export type RoomDoc = InferSchemaType<typeof roomSchema>
export const Room = model('Room', roomSchema)
