import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { SQLiteStorage } from '../storage/sqlite'

const ExtractBodySchema = z.object({
  transcript: z.string().min(1).max(100000),
  provider: z.enum(['anthropic', 'openai']).optional(),
  api_key: z.string().optional(),
  source_tool: z.string().max(100).default('omp-extract'),
})

interface ExtractedMemory {
  content: string
  type: 'episodic' | 'semantic' | 'procedural'
  tags: string[]
}

const EXTRACT_PROMPT = `You are a memory extraction assistant. Extract key facts, preferences, decisions, and context from the following conversation transcript.

Return ONLY a JSON array of memory objects. Each object must have:
- "content": string (the memory, written as a factual statement in third person)
- "type": "episodic" | "semantic" | "procedural" (episodic=events that happened, semantic=facts/preferences/knowledge, procedural=how-to/workflows)
- "tags": string[] (relevant lowercase tags, max 5, alphanumeric and hyphens only)

Extract 2-10 memories. Focus on durable facts useful in future conversations. Skip greetings and trivial chitchat.

Transcript:
`

async function callAI(transcript: string, provider: string, apiKey: string): Promise<ExtractedMemory[]> {
  const prompt = EXTRACT_PROMPT + transcript + '\n\nReturn only the JSON array, no other text.'

  let text: string

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { content: Array<{ type: string; text: string }> }
    text = data.content.find((c) => c.type === 'text')?.text ?? '[]'
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    text = data.choices[0]?.message?.content ?? '[]'
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/)
  return jsonMatch ? JSON.parse(jsonMatch[0]) as ExtractedMemory[] : []
}

export function extractRouter(storage: SQLiteStorage): Router {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const parsed = ExtractBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(422).json({
        error: 'validation_error',
        message: 'Request body failed schema validation',
        details: parsed.error.flatten(),
      })
    }

    const { transcript, source_tool } = parsed.data
    const provider = parsed.data.provider ?? process.env.OMP_AI_PROVIDER ?? 'anthropic'
    const apiKey = parsed.data.api_key ?? process.env.OMP_AI_API_KEY ?? ''

    if (!apiKey) {
      return res.status(422).json({
        error: 'no_api_key',
        message: 'No AI API key provided. Set OMP_AI_API_KEY env var or pass api_key in request body.',
      })
    }

    let extracted: ExtractedMemory[]
    try {
      extracted = await callAI(transcript, provider, apiKey)
    } catch (err) {
      return res.status(502).json({
        error: 'ai_error',
        message: err instanceof Error ? err.message : String(err),
      })
    }

    const memories = []
    for (const m of extracted) {
      if (!m.content || !['episodic', 'semantic', 'procedural'].includes(m.type)) continue
      const tags = Array.isArray(m.tags)
        ? m.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 5)
        : []
      memories.push(storage.create({
        content: m.content.slice(0, 10000),
        type: m.type,
        source: { tool: source_tool, timestamp: new Date().toISOString() },
        tags,
      }))
    }

    return res.status(201).json({ extracted: memories.length, memories })
  })

  return router
}
