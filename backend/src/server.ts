import { app } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { env } from './config/env.js'

const server = await connectDatabase().then(() => app.listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`)))

const shutdown = async () => {
  server.close(async () => { await disconnectDatabase(); process.exit(0) })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
