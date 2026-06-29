import { Router, Request, Response } from 'express'
import { ZodError } from 'zod'
import { CreateMemorySchema, UpdateMemorySchema, SearchMemoriesSchema } from '../types'
import type { SQLiteStorage } from '../storage/sqlite'

function validationError(res: Response, err: ZodError) {
  return res.status(422).json({
    error: 'validation_error',
    message: 'Request body failed schema validation',
    details: err.flatten(),
  })
}

export function memoriesRouter(storage: SQLiteStorage): Router {
  const router = Router()

  router.post('/', (req: Request, res: Response) => {
    const parsed = CreateMemorySchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)

    const memory = storage.create(parsed.data)
    return res.status(201).json(memory)
  })

  router.get('/', (req: Request, res: Response) => {
    const { type, tool, tags, namespace, limit, offset, sort } = req.query

    const result = storage.list({
      type: type as string | undefined,
      tool: tool as string | undefined,
      tags: tags ? String(tags).split(',') : undefined,
      namespace: namespace as string | undefined,
      limit: limit ? parseInt(String(limit)) : undefined,
      offset: offset ? parseInt(String(offset)) : undefined,
    })

    return res.json(result)
  })

  router.get('/:id', (req: Request, res: Response) => {
    const memory = storage.getById(req.params.id)
    if (!memory) return res.status(404).json({ error: 'memory_not_found', message: 'Memory not found' })
    return res.json(memory)
  })

  router.put('/:id', (req: Request, res: Response) => {
    const parsed = UpdateMemorySchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)

    const memory = storage.update(req.params.id, parsed.data)
    if (!memory) return res.status(404).json({ error: 'memory_not_found', message: 'Memory not found' })
    return res.json(memory)
  })

  router.delete('/:id', (req: Request, res: Response) => {
    const deleted = storage.delete(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'memory_not_found', message: 'Memory not found' })
    return res.status(204).send()
  })

  router.post('/search', (req: Request, res: Response) => {
    const parsed = SearchMemoriesSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)

    const result = storage.search(parsed.data)
    return res.json(result)
  })

  return router
}
