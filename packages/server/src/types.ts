import { z } from 'zod'

export const MemoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural'])

export const MemorySourceSchema = z.object({
  tool: z.string().min(1).max(100),
  session_id: z.string().max(255).optional(),
  user_id: z.string().max(255).optional(),
  timestamp: z.string().datetime(),
})

export const CreateMemorySchema = z.object({
  content: z.string().min(1).max(10000),
  type: MemoryTypeSchema,
  source: MemorySourceSchema,
  tags: z.array(z.string().min(1).max(50).regex(/^[a-z0-9_:\-]+$/)).max(20).default([]),
  namespace: z.string().max(100).regex(/^[a-z0-9_:\-]+$/).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const UpdateMemorySchema = CreateMemorySchema.partial().omit({ source: true }).extend({
  source: MemorySourceSchema.partial().optional(),
})

export const SearchMemoriesSchema = z.object({
  q: z.string().min(1),
  type: MemoryTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  namespace: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(10),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('keyword'),
})

export type MemoryType = z.infer<typeof MemoryTypeSchema>
export type MemorySource = z.infer<typeof MemorySourceSchema>
export type CreateMemoryInput = z.infer<typeof CreateMemorySchema>
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>
export type SearchMemoriesInput = z.infer<typeof SearchMemoriesSchema>

export interface Memory {
  id: string
  content: string
  type: MemoryType
  source: MemorySource
  tags: string[]
  namespace: string | null
  created_at: string
  updated_at: string
  expires_at: string | null
  metadata: Record<string, unknown>
}

export interface ListResult {
  memories: Memory[]
  total: number
  limit: number
  offset: number
}

export interface SearchResult {
  memories: Memory[]
  total: number
  mode_used: string
}
