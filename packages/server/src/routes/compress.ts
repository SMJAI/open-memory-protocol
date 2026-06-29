import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { SQLiteStorage } from '../storage/sqlite'

const CompressBodySchema = z.object({
  transcript: z.string().min(1).max(200000),
  provider: z.enum(['anthropic', 'openai']).optional(),
  api_key: z.string().optional(),
  source_tool: z.string().max(100).default('omp-compress'),
})

const COMPRESS_PROMPT = `Summarise the following conversation in 2-3 clear, factual sentences. Focus on what was discussed, decided, or accomplished. Write it as a past-tense summary that would be useful context in a future conversation. Return only the summary, no other text.

Transcript:
`

async function callAI(transcript: string, provider: string, apiKey: string): Promise<string> {
  const prompt = COMPRESS_PROMPT + transcript

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
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`)
    const data = await res.json() as { content: Array<{ type: string; text: string }> }
    return data.content.find((c) => c.type === 'text')?.text?.trim() ?? ''
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
    return data.choices[0]?.message?.content?.trim() ?? ''
  }
}

export function compressRouter(storage: SQLiteStorage): Router {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const parsed = CompressBodySchema.safeParse(req.body)
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

    let summary: string
    try {
      summary = await callAI(transcript, provider, apiKey)
    } catch (err) {
      return res.status(502).json({
        error: 'ai_error',
        message: err instanceof Error ? err.message : String(err),
      })
    }

    if (!summary) {
      return res.status(502).json({ error: 'ai_error', message: 'AI returned empty summary' })
    }

    const memory = storage.create({
      content: summary.slice(0, 10000),
      type: 'episodic',
      source: { tool: source_tool, timestamp: new Date().toISOString() },
      tags: ['session-summary'],
    })

    return res.status(201).json({ memory })
  })

  return router
}
