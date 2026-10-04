import { existsSync } from 'node:fs'
import dotenv from 'dotenv'
import { z } from 'zod'

const candidatePaths = [process.env.DOTENV_CONFIG_PATH, '.env', 'backend/.env', '../backend/.env']
const envPath = candidatePaths.find((candidate): candidate is string => typeof candidate === 'string' && existsSync(candidate))
if (envPath) dotenv.config({ path: envPath })
else dotenv.config()

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('splitsense_v2'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export const env = schema.parse(process.env)
