import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { connectDatabase } from './config/database.js'
import { User } from './models/User.js'
import { Room } from './models/Room.js'
import { Membership } from './models/Membership.js'
import { Expense } from './models/Expense.js'
import { Payment } from './models/Payment.js'
import { AuditEvent } from './models/AuditEvent.js'

await connectDatabase()
await Promise.all([User.deleteMany({}), Room.deleteMany({}), Membership.deleteMany({}), Expense.deleteMany({}), Payment.deleteMany({}), AuditEvent.deleteMany({})])
const users = await User.insertMany(['Akshay', 'Rahul', 'Priya', 'Aman'].map((displayName) => ({ displayName })))
const room = await Room.create({ publicId: 'GP7K29', name: 'Green Park Flat', createdBy: users[0]._id, adminId: users[0]._id, recoveryPasswordHash: await bcrypt.hash('development-only-password', 12) })
await Membership.insertMany(users.map((user, index) => ({ userId: user._id, roomId: room._id, role: index === 0 ? 'admin' : 'member', status: 'active', joinedAt: new Date() })))
await Expense.create([
  { roomId: room._id, description: 'Groceries', amountPaise: 184000, payerId: users[0]._id, participants: users.map((user) => user._id), allocations: users.map((user) => ({ userId: user._id, amountPaise: 46000 })), splitMethod: 'equal', expenseDate: new Date(), createdBy: users[0]._id },
  { roomId: room._id, description: 'Electricity', amountPaise: 243000, payerId: users[1]._id, participants: users.map((user) => user._id), allocations: users.map((user) => ({ userId: user._id, amountPaise: 60750 })), splitMethod: 'equal', expenseDate: new Date(Date.now() - 86_400_000), createdBy: users[1]._id },
])
console.log(`Seeded ${room.name} (${room.publicId})`)
await mongoose.disconnect()
