import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectDatabase() {
	const connection = await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB })
	await connection.connection.collection('users').dropIndex('email_1').catch((error: { codeName?: string }) => {
		if (error.codeName !== 'IndexNotFound') throw error
	})
	return connection
}
export const disconnectDatabase = () => mongoose.disconnect()
