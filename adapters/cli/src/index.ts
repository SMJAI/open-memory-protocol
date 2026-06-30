#!/usr/bin/env node
/**
 * omp — Open Memory Protocol CLI
 * Brings OMP memory to any AI CLI tool (Aider, Claude Code, custom agents).
 *
 * Usage:
 *   omp context              Print memory context ready to paste or pipe
 *   omp recent               List recent saved conversations
 *   omp handoff [--from X]   Generate a handoff brief from the last conversation
 *   omp save [--model X]     Read stdin and save as a conversation
 *   omp remember "text"      Save a single memory
 *   omp recall "query"       Search memories
 */

import * as readline from 'readline'

const SERVER  = process.env.OMP_SERVER  ?? 'http://localhost:3456'
const API_KEY = process.env.OMP_API_KEY ?? ''

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`
  return h
}

async function get(path: string) {
  const res = await fetch(`${SERVER}${path}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`OMP error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OMP error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  return new Promise(resolve => {
    const chunks: string[] = []
    const rl = readline.createInterface({ input: process.stdin })
    rl.on('line', line => chunks.push(line))
    rl.on('close', () => resolve(chunks.join('\n')))
  })
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdContext() {
  const data = await get('/v1/memories?limit=20') as { memories: Array<{ type: string; content: string }> }
  if (!data.memories.length) {
    console.log('[No OMP memories yet. Start chatting with Claude Desktop or save memories with: omp remember "text"]')
    return
  }
  const lines = data.memories.map((m: { type: string; content: string }) => `- [${m.type}] ${m.content}`)
  console.log('[Memory context from OMP]')
  console.log(lines.join('\n'))
  console.log('\n---\n')
}

async function cmdRecent() {
  const data = await get('/v1/conversations?limit=10') as { conversations: Array<{ id: string; model: string; topic: string; message_count: number; created_at: string }> }
  if (!data.conversations.length) {
    console.log('No conversations saved yet.')
    return
  }
  console.log('Recent conversations:\n')
  data.conversations.forEach((c, i) => {
    const ago = Math.round((Date.now() - new Date(c.created_at).getTime()) / 60000)
    console.log(`  ${i + 1}. [${c.model}] ${c.topic.slice(0, 70)} (${c.message_count} msgs, ${ago}m ago)`)
    console.log(`     id: ${c.id}`)
  })
}

async function cmdHandoff(args: string[]) {
  const fromIdx = args.indexOf('--from')
  const fromModel = fromIdx !== -1 ? args[fromIdx + 1] : undefined
  const toModel = (args[args.indexOf('--to') + 1] ?? process.env.OMP_TARGET_MODEL ?? 'claude')

  const params = new URLSearchParams({ limit: '1' })
  if (fromModel) params.set('model', fromModel)

  const data = await get(`/v1/conversations?${params}`) as { conversations: Array<{ id: string; model: string }> }
  if (!data.conversations.length) {
    console.error('No saved conversations found.' + (fromModel ? ` (from: ${fromModel})` : ''))
    console.error('Save one first with: omp save --model chatgpt < session.txt')
    process.exit(1)
  }

  const conv = data.conversations[0]
  const handoff = await post('/v1/handoff', {
    conversation_id: conv.id,
    target_model: toModel,
  }) as { brief: string; topic: string; source_model: string }

  console.log(handoff.brief)
}

async function cmdSave(args: string[]) {
  const modelIdx = args.indexOf('--model')
  const model = modelIdx !== -1 ? args[modelIdx + 1] : 'cli'

  const text = await readStdin()
  if (!text.trim()) {
    console.error('No input. Pipe text into omp save:')
    console.error('  echo "conversation text" | omp save --model aider')
    console.error('  omp save --model aider < session.txt')
    process.exit(1)
  }

  // Parse stdin as alternating turns or raw text
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  // Try to detect "User:" / "AI:" / "Assistant:" patterns
  const lines = text.split('\n')
  let current: { role: 'user' | 'assistant'; lines: string[] } | null = null

  for (const line of lines) {
    const userMatch = line.match(/^(User|Human|You|Me):\s*(.*)/i)
    const aiMatch   = line.match(/^(AI|Assistant|Claude|ChatGPT|GPT|Aider|Bot):\s*(.*)/i)

    if (userMatch) {
      if (current) messages.push({ role: current.role, content: current.lines.join('\n').trim() })
      current = { role: 'user', lines: [userMatch[2]] }
    } else if (aiMatch) {
      if (current) messages.push({ role: current.role, content: current.lines.join('\n').trim() })
      current = { role: 'assistant', lines: [aiMatch[2]] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) messages.push({ role: current.role, content: current.lines.join('\n').trim() })

  // If no structure detected, save whole text as one user message
  if (messages.length === 0) {
    messages.push({ role: 'user', content: text.slice(0, 10000) })
  }

  const saved = await post('/v1/conversations', { model, messages }) as { id: string; message_count: number }
  console.log(`✓ Saved ${saved.message_count} messages from [${model}] — id: ${saved.id}`)
}

async function cmdRemember(args: string[]) {
  const content = args.filter(a => !a.startsWith('-')).join(' ')
  if (!content) {
    console.error('Usage: omp remember "what to remember"')
    process.exit(1)
  }
  const mem = await post('/v1/memories', {
    content,
    type: 'semantic',
    source: { tool: 'omp-cli', timestamp: new Date().toISOString() },
    tags: ['cli'],
  }) as { id: string }
  console.log(`✓ Memory saved — id: ${mem.id}`)
}

async function cmdRecall(args: string[]) {
  const query = args.filter(a => !a.startsWith('-')).join(' ')
  if (!query) {
    console.error('Usage: omp recall "search query"')
    process.exit(1)
  }
  const data = await post('/v1/memories/search', { q: query, limit: 5 }) as { memories: Array<{ type: string; content: string }> }
  if (!data.memories.length) {
    console.log('No matching memories.')
    return
  }
  data.memories.forEach((m: { type: string; content: string }) => console.log(`[${m.type}] ${m.content}`))
}

function help() {
  console.log(`
omp — Open Memory Protocol CLI

COMMANDS
  omp context                    Print your OMP memories (pipe into any AI)
  omp recent                     List recently saved conversations
  omp handoff [--from MODEL]     Generate handoff brief from last conversation
  omp save [--model MODEL]       Read stdin, save as a conversation
  omp remember "text"            Save a single memory
  omp recall "query"             Search your memories

EXAMPLES
  # See your memories
  omp context

  # Start Aider with OMP context
  omp context > /tmp/omp.md && aider --read /tmp/omp.md

  # Continue a ChatGPT conversation in Claude Code
  claude "$(omp handoff --from chatgpt)"

  # Save an Aider session to OMP
  omp save --model aider < session.txt

  # Quick memory
  omp remember "Decided to use PostgreSQL over SQLite for production"

ENVIRONMENT
  OMP_SERVER    OMP server URL (default: http://localhost:3456)
  OMP_API_KEY   API key if your server requires one
`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [,, cmd, ...args] = process.argv

  try {
    switch (cmd) {
      case 'context':   await cmdContext(); break
      case 'recent':    await cmdRecent(); break
      case 'handoff':   await cmdHandoff(args); break
      case 'save':      await cmdSave(args); break
      case 'remember':  await cmdRemember(args); break
      case 'recall':    await cmdRecall(args); break
      case 'help':
      case '--help':
      case '-h':
      case undefined:   help(); break
      default:
        console.error(`Unknown command: ${cmd}`)
        console.error('Run "omp help" for usage.')
        process.exit(1)
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err))
    console.error(`\nIs the OMP server running? Start it with: npx omp-server`)
    process.exit(1)
  }
}

main()
