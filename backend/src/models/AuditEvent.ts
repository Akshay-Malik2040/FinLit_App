import { model, Schema } from 'mongoose'

const auditEventSchema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  entityType: { type: String, enum: ['expense', 'payment', 'membership', 'room'], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true, index: true },
  action: { type: String, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  changedFields: { type: Schema.Types.Mixed },
  previousValues: { type: Schema.Types.Mixed },
  newValues: { type: Schema.Types.Mixed },
}, { timestamps: true })
auditEventSchema.index({ roomId: 1, createdAt: -1 })

export const AuditEvent = model('AuditEvent', auditEventSchema)
