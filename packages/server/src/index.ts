import express from 'express'
import path from 'path'
import { SQLiteStorage } from './storage/sqlite'
import { memoriesRouter } from './routes/memories'
import { extractRouter } from './routes/extract'
import { compressRouter } from './routes/compress'
import { conversationsRouter } from './routes/conversations'
import { handoffRouter } from './routes/handoff'

const PORT = parseInt(process.env.OMP_PORT ?? '3456')
const DB_PATH = process.env.OMP_DB_PATH ?? path.join(process.cwd(), 'data', 'omp.db')
const API_KEY = process.env.OMP_API_KEY ?? ''

if (!API_KEY) {
  console.warn('[OMP] Warning: OMP_API_KEY not set. Server is running without authentication.')
}

const storage = new SQLiteStorage(DB_PATH)
const app = express()

app.use(express.json({ limit: '1mb' }))

app.use((req, res, next) => {
  if (req.path === '/v1/health') return next()
  if (!API_KEY) return next()

  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' })
  }
  next()
})

app.get('/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1',
    compliance: 'OMP-Core',
    memories_count: storage.count(),
  })
})

app.use('/v1/memories', memoriesRouter(storage))
app.use('/v1/extract', extractRouter(storage))
app.use('/v1/compress', compressRouter(storage))
app.use('/v1/conversations', conversationsRouter(storage))
app.use('/v1/handoff', handoffRouter(storage))

app.get('/v1/export', (_req, res) => {
  const memories = storage.exportAll()
  res.json({
    omp_version: '0.1',
    exported_at: new Date().toISOString(),
    server: 'omp-reference-server',
    memories,
  })
})

app.post('/v1/import', (req, res) => {
  const { memories, conflict = 'skip' } = req.body
  if (!Array.isArray(memories)) {
    return res.status(422).json({ error: 'validation_error', message: '"memories" must be an array' })
  }
  const result = storage.importMany(memories, conflict)
  return res.json({ ...result, errors: [] })
})

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Endpoint not found' })
})

app.listen(PORT, () => {
  console.log(`[OMP] Open Memory Protocol server running on port ${PORT}`)
  console.log(`[OMP] Database: ${DB_PATH}`)
  console.log(`[OMP] Health: http://localhost:${PORT}/v1/health`)
})

export default app
