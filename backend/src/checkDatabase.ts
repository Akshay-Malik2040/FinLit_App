import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from './config/database.js'

try {
  await connectDatabase()
  await mongoose.connection.db?.command({ ping: 1 })
  console.log(`MongoDB connection verified (${mongoose.connection.name})`)
} finally {
  await disconnectDatabase()
}
