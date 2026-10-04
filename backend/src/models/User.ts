import { model, Schema } from 'mongoose'

const userSchema = new Schema({
  displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
}, { timestamps: true })

export const User = model('User', userSchema)
