#!/usr/bin/env node
/**
 * omp — Open Memory Protocol CLI
 * Brings OMP memory to any AI coding tool.
 *
 * Usage:
 *   omp context              Print memory context (pipe into any AI)
 *   omp inject [--for TOOL]  Write context file for a specific AI tool
 *   omp recent               List recent saved conversations
 *   omp handoff [--from X]   Generate a handoff brief from the last conversation
 *   omp save [--model X]     Read stdin and save as a conversation
 *   omp remember "text"      Save a single memory
 *   omp recall "query"       Search memories
 *   omp setup claude-code    Wire up OMP MCP server into Claude Code
 */

import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

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

async function cmdInject(args: string[]) {
  const forIdx = args.indexOf('--for')
  const tool   = forIdx !== -1 ? args[forIdx + 1]?.toLowerCase() : 'file'
  const cwd    = process.cwd()

  // Build the context block
  const data = await get('/v1/memories?limit=30') as { memories: Array<{ type: string; content: string; tags: string[] }> }
  const convData = await get('/v1/conversations?limit=3') as { conversations: Array<{ model: string; topic: string; message_count: number }> }

  const memLines = data.memories.length
    ? data.memories.map(m => `- [${m.type}] ${m.content}`).join('\n')
    : '- No memories saved yet.'

  const convLines = convData.conversations.length
    ? convData.conversations.map(c => `- [${c.model}] ${c.topic.slice(0, 80)} (${c.message_count} msgs)`).join('\n')
    : '- No recent conversations.'

  const block = [
    '<!-- OMP: Open Memory Protocol context — auto-generated, do not edit manually -->',
    '## My Memory Context (from OMP)',
    '',
    '### Memories',
    memLines,
    '',
    '### Recent conversations across AI tools',
    convLines,
    '',
    `_Updated: ${new Date().toLocaleString()}_`,
    '<!-- /OMP -->',
  ].join('\n')

  const targets: Record<string, { file: string; label: string; wrap?: (block: string) => string }> = {
    cursor: {
      file: path.join(cwd, '.cursorrules'),
      label: 'Cursor (.cursorrules)',
    },
    copilot: {
      file: path.join(cwd, '.github', 'copilot-instructions.md'),
      label: 'GitHub Copilot (.github/copilot-instructions.md)',
    },
    codex: {
      file: path.join(cwd, 'AGENTS.md'),
      label: 'Codex CLI (AGENTS.md)',
    },
    'claude-code': {
      file: path.join(cwd, 'CLAUDE.md'),
      label: 'Claude Code (CLAUDE.md)',
    },
    continue: {
      file: path.join(cwd, '.continue', 'context.md'),
      label: 'Continue.dev (.continue/context.md)',
    },
    file: {
      file: path.join(cwd, 'omp-context.md'),
      label: 'Generic file (omp-context.md)',
    },
  }

  const target = targets[tool ?? 'file'] ?? targets['file']

  // Replace existing OMP block or append
  const filePath = target.file
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  let existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''

  const OMP_START = '<!-- OMP:'
  const OMP_END   = '<!-- /OMP -->'

  if (existing.includes(OMP_START)) {
    const startIdx = existing.indexOf(OMP_START)
    const endIdx   = existing.indexOf(OMP_END)
    existing = existing.slice(0, startIdx).trimEnd() + '\n\n' + block + '\n' + existing.slice(endIdx + OMP_END.length).trimStart()
  } else {
    existing = existing.trimEnd() + (existing ? '\n\n' : '') + block + '\n'
  }

  fs.writeFileSync(filePath, existing, 'utf8')
  console.log(`✓ OMP context written to ${target.label}`)
  console.log(`  ${filePath}`)
  console.log(`  ${data.memories.length} memories, ${convData.conversations.length} recent conversations`)
}

async function cmdSetup(args: string[]) {
  const tool = args[0]?.toLowerCase()

  if (tool === 'claude-code') {
    // Find the omp-mcp adapter path
    const adapterPaths = [
      path.join(__dirname, '..', '..', 'claude-mcp', 'dist', 'index.js'),
      path.join(os.homedir(), 'OpenMemoryProtocol', 'adapters', 'claude-mcp', 'dist', 'index.js'),
      'C:\\OpenMemoryProtocol\\adapters\\claude-mcp\\dist\\index.js',
    ]
    const adapterPath = adapterPaths.find(p => fs.existsSync(p))

    if (!adapterPath) {
      console.log('OMP MCP adapter not found at expected paths.')
      console.log('Add it manually to your Claude Code config:')
      console.log('')
      console.log('  claude mcp add omp -- node /path/to/omp-mcp/dist/index.js')
      console.log('')
      console.log('Or add to .mcp.json in your project:')
      console.log(JSON.stringify({
        mcpServers: {
          omp: {
            command: 'npx',
            args: ['omp-mcp'],
            env: { OMP_SERVER: SERVER },
          },
        },
      }, null, 2))
      return
    }

    console.log('Found OMP MCP adapter at:', adapterPath)
    console.log('')
    console.log('Run this command to add OMP to Claude Code:')
    console.log('')
    console.log(`  claude mcp add omp -- node "${adapterPath}"`)
    console.log('')
    console.log('Or add this to your project .mcp.json:')
    console.log(JSON.stringify({
      mcpServers: {
        omp: {
          command: 'node',
          args: [adapterPath],
          env: { OMP_SERVER: SERVER },
        },
      },
    }, null, 2))
    return
  }

  // Generic setup help
  console.log(`
OMP setup for AI coding tools:

CLAUDE CODE (VS Code / terminal)
  claude mcp add omp -- npx omp-mcp
  → Gives Claude Code omp_remember, omp_recall, omp_compress tools

CURSOR
  omp inject --for cursor
  → Writes your memories to .cursorrules (auto-read by Cursor)

GITHUB COPILOT
  omp inject --for copilot
  → Writes to .github/copilot-instructions.md (Copilot reads this per-repo)

CODEX CLI (OpenAI)
  omp inject --for codex          # write context to AGENTS.md
  codex                           # Codex reads AGENTS.md automatically
  # OR pipe directly:
  codex --instructions "$(omp context)"

CONTINUE.DEV
  omp inject --for continue
  → Writes to .continue/context.md

ANY OTHER TOOL
  omp context | <your-ai-cli>
  # OR
  omp inject   # writes to omp-context.md, include it manually
`)
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
  omp context                       Print your OMP memories (pipe into any AI)
  omp inject [--for TOOL]           Write memory context file for a specific tool
  omp setup [TOOL]                  Show setup instructions for an AI tool
  omp recent                        List recently saved conversations
  omp handoff [--from MODEL]        Generate handoff brief from last conversation
  omp save [--model MODEL]          Read stdin, save as a conversation
  omp remember "text"               Save a single memory
  omp recall "query"                Search your memories

SUPPORTED TOOLS (omp inject --for ...)
  cursor       → .cursorrules
  copilot      → .github/copilot-instructions.md
  codex        → AGENTS.md
  claude-code  → CLAUDE.md
  continue     → .continue/context.md
  file         → omp-context.md (default)

EXAMPLES
  # Wire up Claude Code (VS Code / terminal)
  omp setup claude-code

  # Inject memories into Cursor for the current project
  omp inject --for cursor

  # Use Codex CLI with OMP context
  omp inject --for codex && codex

  # Pipe directly into any AI CLI
  codex --instructions "$(omp context)"

  # Continue a ChatGPT chat in Claude Code
  claude "$(omp handoff --from chatgpt)"

  # Save an Aider session to OMP
  omp save --model aider < session.txt

  # Quick memory save
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
      case 'inject':    await cmdInject(args); break
      case 'setup':     await cmdSetup(args); break
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
