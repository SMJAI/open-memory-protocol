import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { SQLiteStorage } from '../storage/sqlite'

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(10000),
})

const SaveConversationSchema = z.object({
  model: z.string().min(1).max(100),
  topic: z.string().max(200).optional(),
  messages: z.array(MessageSchema).min(1).max(500),
  source_url: z.string().max(500).optional(),
})

export function conversationsRouter(storage: SQLiteStorage): Router {
  const router = Router()

  router.post('/', (req: Request, res: Response) => {
    const parsed = SaveConversationSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(422).json({ error: 'validation_error', details: parsed.error.flatten() })
    }
    const conversation = storage.saveConversation(parsed.data)
    return res.status(201).json(conversation)
  })

  router.get('/', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)
    const model = (req.query.model as string) || undefined
    const exclude_model = (req.query.exclude_model as string) || undefined
    const since = (req.query.since as string) || undefined
    const conversations = storage.listConversations({ model, exclude_model, since, limit })
    return res.json({ conversations, total: conversations.length })
  })

  router.get('/:id', (req: Request, res: Response) => {
    const conv = storage.getConversation(req.params.id)
    if (!conv) return res.status(404).json({ error: 'not_found', message: 'Conversation not found' })
    return res.json(conv)
  })

  router.delete('/:id', (req: Request, res: Response) => {
    const deleted = storage.deleteConversation(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'not_found', message: 'Conversation not found' })
    return res.json({ deleted: true })
  })

  return router
}
