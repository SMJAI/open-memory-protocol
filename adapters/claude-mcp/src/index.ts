#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const OMP_SERVER = process.env.OMP_SERVER ?? 'http://localhost:3456'
const OMP_API_KEY = process.env.OMP_API_KEY ?? ''

interface OmpErrorBody {
  error: string
  message: string
}

interface MemoryResult {
  id: string
  type: string
  content: string
  created_at: string
  tags: string[]
}

interface ListOrSearchResult {
  memories: MemoryResult[]
  total: number
}

interface ExtractResult {
  extracted: number
  memories: MemoryResult[]
}

interface CompressResult {
  memory: MemoryResult
}

async function ompFetch<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${OMP_SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(OMP_API_KEY ? { Authorization: `Bearer ${OMP_API_KEY}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const errBody = (await res.json()) as OmpErrorBody
    throw new Error(errBody.message ?? `OMP error ${res.status}`)
  }
  return (await res.json()) as T
}

const server = new Server(
  { name: 'omp-memory', version: '0.2.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
)

// ── Tools ──────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'omp_remember',
      description: 'Save a memory to the Open Memory Protocol server. Use this to persist important facts, preferences, or context about the user that should be available across sessions and tools.',
      inputSchema: {
        type: 'object',
        required: ['content', 'type'],
        properties: {
          content: { type: 'string', description: 'The memory to store, in plain natural language' },
          type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'episodic=events, semantic=facts/preferences, procedural=workflows' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for organisation' },
          namespace: { type: 'string', description: 'Optional namespace e.g. project:myapp' },
        },
      },
    },
    {
      name: 'omp_recall',
      description: 'Search memories from the Open Memory Protocol server. Use this at the start of conversations to retrieve relevant context about the user.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'What to search for' },
          type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'Filter by memory type' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          namespace: { type: 'string', description: 'Filter by namespace' },
        },
      },
    },
    {
      name: 'omp_forget',
      description: 'Delete a specific memory by ID from the Open Memory Protocol server.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'The memory ID to delete (starts with mem_)' },
        },
      },
    },
    {
      name: 'omp_list',
      description: 'List recent memories from the Open Memory Protocol server.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
          tags: { type: 'string', description: 'Comma-separated tags to filter by' },
          namespace: { type: 'string' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'omp_extract',
      description: 'Extract and save memories from a conversation transcript using AI. Automatically identifies facts, preferences, and context worth remembering. Requires OMP_AI_API_KEY to be set on the server.',
      inputSchema: {
        type: 'object',
        required: ['transcript'],
        properties: {
          transcript: { type: 'string', description: 'The conversation transcript to extract memories from' },
          source_tool: { type: 'string', description: 'Name of the source tool (default: claude)' },
        },
      },
    },
    {
      name: 'omp_compress',
      description: 'Compress a long conversation into a single episodic memory summary. Use at the end of long sessions to preserve what was discussed. Requires OMP_AI_API_KEY to be set on the server.',
      inputSchema: {
        type: 'object',
        required: ['transcript'],
        properties: {
          transcript: { type: 'string', description: 'The conversation transcript to compress into a summary' },
          source_tool: { type: 'string', description: 'Name of the source tool (default: claude)' },
        },
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params
  const args = request.params.arguments ?? {}

  try {
    if (name === 'omp_remember') {
      const memory = await ompFetch<MemoryResult>('/v1/memories', 'POST', {
        content: args.content,
        type: args.type,
        source: { tool: 'claude', timestamp: new Date().toISOString() },
        tags: args.tags ?? [],
        namespace: args.namespace ?? null,
      })
      return {
        content: [{ type: 'text', text: `Memory saved: ${memory.id}\n"${memory.content}"` }],
      }
    }

    if (name === 'omp_recall') {
      const result = await ompFetch<ListOrSearchResult>('/v1/memories/search', 'POST', {
        q: args.query,
        type: args.type,
        namespace: args.namespace,
        limit: args.limit ?? 10,
        mode: 'keyword',
      })
      if (result.memories.length === 0) {
        return { content: [{ type: 'text', text: 'No memories found.' }] }
      }
      const formatted = result.memories.map((m) =>
        `[${m.id}] (${m.type}) ${m.content}\nSaved: ${m.created_at} | Tags: ${m.tags.join(', ') || 'none'}`
      ).join('\n\n')
      return { content: [{ type: 'text', text: formatted }] }
    }

    if (name === 'omp_forget') {
      await ompFetch(`/v1/memories/${args.id}`, 'DELETE')
      return { content: [{ type: 'text', text: `Memory ${args.id} deleted.` }] }
    }

    if (name === 'omp_list') {
      const params = new URLSearchParams()
      if (args.type) params.set('type', String(args.type))
      if (args.tags) params.set('tags', String(args.tags))
      if (args.namespace) params.set('namespace', String(args.namespace))
      if (args.limit) params.set('limit', String(args.limit))

      const result = await ompFetch<ListOrSearchResult>(`/v1/memories?${params}`)
      if (result.memories.length === 0) {
        return { content: [{ type: 'text', text: 'No memories stored yet.' }] }
      }
      const formatted = result.memories.map((m) =>
        `[${m.id}] (${m.type}) ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`
      ).join('\n')
      return { content: [{ type: 'text', text: `${result.total} memories total:\n\n${formatted}` }] }
    }

    if (name === 'omp_extract') {
      const result = await ompFetch<ExtractResult>('/v1/extract', 'POST', {
        transcript: args.transcript,
        source_tool: args.source_tool ?? 'claude',
      })
      if (result.extracted === 0) {
        return { content: [{ type: 'text', text: 'No memories extracted from transcript.' }] }
      }
      const formatted = result.memories.map((m) => `- [${m.type}] ${m.content}`).join('\n')
      return {
        content: [{ type: 'text', text: `Extracted and saved ${result.extracted} memories:\n\n${formatted}` }],
      }
    }

    if (name === 'omp_compress') {
      const result = await ompFetch<CompressResult>('/v1/compress', 'POST', {
        transcript: args.transcript,
        source_tool: args.source_tool ?? 'claude',
      })
      return {
        content: [{
          type: 'text',
          text: `Session compressed and saved as memory (${result.memory.id}):\n\n"${result.memory.content}"`,
        }],
      }
    }

    throw new Error(`Unknown tool: ${name}`)
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    }
  }
})

// ── Resources ──────────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'omp://memories/context',
      name: 'Memory Context',
      description: 'Your 20 most recent OMP memories — auto-injected as context at conversation start',
      mimeType: 'text/plain',
    },
  ],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params
  if (uri !== 'omp://memories/context') {
    throw new Error(`Unknown resource: ${uri}`)
  }

  const result = await ompFetch<ListOrSearchResult>('/v1/memories?limit=20')
  if (result.memories.length === 0) {
    return {
      contents: [{ uri, mimeType: 'text/plain', text: 'No memories stored yet.' }],
    }
  }

  const lines = result.memories.map((m) =>
    `- [${m.type}] ${m.content}${m.tags.length ? ` (${m.tags.join(', ')})` : ''}`
  )
  return {
    contents: [{
      uri,
      mimeType: 'text/plain',
      text: `# OMP Memory Context (${result.memories.length} recent memories)\n\n${lines.join('\n')}`,
    }],
  }
})

// ── Prompts ────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'load_memories',
      description: 'Load relevant memories from OMP to provide context for the current task',
      arguments: [
        {
          name: 'query',
          description: 'What to search for (leave empty for recent memories)',
          required: false,
        },
      ],
    },
  ],
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const query = (request.params.arguments as Record<string, string> | undefined)?.query

  let memoryText: string
  if (query) {
    const result = await ompFetch<ListOrSearchResult>('/v1/memories/search', 'POST', {
      q: query, limit: 10, mode: 'keyword',
    })
    memoryText = result.memories.length === 0
      ? 'No relevant memories found.'
      : result.memories.map((m) => `- [${m.type}] ${m.content}`).join('\n')
  } else {
    const result = await ompFetch<ListOrSearchResult>('/v1/memories?limit=10')
    memoryText = result.memories.length === 0
      ? 'No memories stored yet.'
      : result.memories.map((m) => `- [${m.type}] ${m.content}`).join('\n')
  }

  return {
    description: 'Memories from Open Memory Protocol',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Here are relevant memories from my memory store:\n\n${memoryText}\n\nPlease use this context as you help me.`,
        },
      },
    ],
  }
})

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[OMP MCP] Open Memory Protocol adapter v0.2.0 running')
  console.error(`[OMP MCP] Server: ${OMP_SERVER}`)
}

main().catch(console.error)
