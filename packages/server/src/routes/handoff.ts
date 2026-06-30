import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { SQLiteStorage } from '../storage/sqlite'

const HandoffSchema = z.object({
  conversation_id: z.string().optional(),
  // inline conversation (if not providing an id)
  model: z.string().max(100).optional(),
  topic: z.string().max(200).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10000),
  })).max(500).optional(),
  target_model: z.string().min(1).max(100),
  provider: z.enum(['anthropic', 'openai']).optional(),
  api_key: z.string().optional(),
})

const MODEL_DISPLAY: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
}

function displayName(model: string): string {
  return MODEL_DISPLAY[model.toLowerCase()] ?? model
}

const HANDOFF_PROMPT = `You are writing a handoff message that a user will paste at the start of a new AI chat to continue a conversation they just had with a different AI.

Source AI: {SOURCE}
Target AI: {TARGET}
Topic: {TOPIC}

Previous conversation (most recent at the bottom):
{MESSAGES}

Write a 2-4 sentence message in first person (the user's voice) that:
- Briefly says what was already covered with {SOURCE} (the key topic and main points)
- Mentions the last thing discussed or what the user was about to ask next
- Asks {TARGET} to pick up naturally from there

Sound natural and conversational. Do NOT start with "I was chatting with..." — vary the opening. Write ONLY the message, nothing else.`

function formatMessages(messages: { role: string; content: string }[], maxChars = 8000): string {
  let out = ''
  for (const m of messages) {
    const prefix = m.role === 'user' ? 'User: ' : 'AI: '
    const line = prefix + m.content.slice(0, 1000) + '\n'
    if (out.length + line.length > maxChars) break
    out += line
  }
  return out.trim()
}

function fallbackBrief(sourceModel: string, targetModel: string, topic: string, messages: { role: string; content: string }[]): string {
  const src = displayName(sourceModel)
  const tgt = displayName(targetModel)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.slice(0, 200) ?? ''
  return `I was just discussing "${topic}" with ${src}. ${lastUserMsg ? `My last question was: "${lastUserMsg}"` : ''} Can you ${tgt === displayName(sourceModel) ? 'continue' : `pick up where ${src} left off`} and help me go deeper on this?`
}

async function generateBrief(
  sourceModel: string,
  targetModel: string,
  topic: string,
  messages: { role: string; content: string }[],
  provider: string,
  apiKey: string,
): Promise<string> {
  const prompt = HANDOFF_PROMPT
    .replace(/{SOURCE}/g, displayName(sourceModel))
    .replace(/{TARGET}/g, displayName(targetModel))
    .replace('{TOPIC}', topic)
    .replace('{MESSAGES}', formatMessages(messages))

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
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}`)
    const data = await res.json() as { content: Array<{ type: string; text: string }> }
    return data.content.find(c => c.type === 'text')?.text?.trim() ?? ''
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}`)
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content?.trim() ?? ''
  }
}

export function handoffRouter(storage: SQLiteStorage): Router {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const parsed = HandoffSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(422).json({ error: 'validation_error', details: parsed.error.flatten() })
    }

    const { conversation_id, target_model } = parsed.data
    const provider = parsed.data.provider ?? process.env.OMP_AI_PROVIDER ?? 'anthropic'
    const apiKey = parsed.data.api_key ?? process.env.OMP_AI_API_KEY ?? ''

    let sourceModel: string
    let topic: string
    let messages: { role: string; content: string }[]

    if (conversation_id) {
      const conv = storage.getConversation(conversation_id)
      if (!conv) return res.status(404).json({ error: 'not_found', message: 'Conversation not found' })
      sourceModel = conv.model
      topic = conv.topic
      messages = conv.messages
    } else if (parsed.data.messages && parsed.data.model) {
      sourceModel = parsed.data.model
      topic = parsed.data.topic ?? parsed.data.messages[0]?.content?.slice(0, 100) ?? 'conversation'
      messages = parsed.data.messages
    } else {
      return res.status(422).json({ error: 'validation_error', message: 'Provide conversation_id or inline model + messages' })
    }

    let brief: string
    if (apiKey) {
      try {
        brief = await generateBrief(sourceModel, target_model, topic, messages, provider, apiKey)
      } catch {
        brief = fallbackBrief(sourceModel, target_model, topic, messages)
      }
    } else {
      brief = fallbackBrief(sourceModel, target_model, topic, messages)
    }

    return res.json({
      brief,
      topic,
      source_model: sourceModel,
      target_model,
      message_count: messages.length,
    })
  })

  return router
}
