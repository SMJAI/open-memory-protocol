# Open Memory Protocol (OMP)

> An open standard for portable, interoperable AI memory across tools, sessions, and devices.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Spec Version](https://img.shields.io/badge/spec-v0.2-green.svg)](SPEC.md)
[![Discord](https://img.shields.io/badge/community-discord-7289da.svg)](#community)

---

## The Problem

Every AI tool remembers you differently — and only within its own walls.

- **Claude** knows what you told it yesterday. Cursor doesn't.
- **ChatGPT** learned your preferences. Your custom agent hasn't.
- **Copilot** saw your code style. Your terminal AI is starting from zero.

Every time you switch tools, your AI forgets you. You repeat yourself. Context is lost. The AI that was finally starting to *know* you resets to a stranger.

This is the **AI memory silo problem**. And it has the same solution as every silo problem before it: an open protocol.

---

## What is OMP?

**Open Memory Protocol** is a vendor-neutral specification for how AI tools store, retrieve, and share memory about users and their context.

It is:
- **A specification** — a precise definition of memory objects, storage format, and HTTP API
- **A reference server** — self-hostable, open-source, runs in Docker in one command
- **A set of SDKs** — TypeScript and Python libraries for building OMP-compatible tools
- **A set of adapters** — plug-ins for Claude (MCP), OpenAI, Cursor, and more

Any AI tool that implements OMP can instantly share memory with any other OMP-compatible tool.

---

## Quick Start

> **Requirements:** Node.js 22 or newer

### 1. Run your memory server

```bash
npx omp-server
```

Or with Docker:

```bash
docker run -p 3456:3456 -v omp-data:/data ghcr.io/smjai/omp-server
```

Your server is now running at `http://localhost:3456`. Test it:

```bash
curl http://localhost:3456/v1/health
# {"status":"ok","version":"0.1","compliance":"OMP-Core","memories_count":0}
```

### 2. Connect Claude (via MCP)

Find your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (Store app):** `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

Add to it:

```json
{
  "mcpServers": {
    "omp": {
      "command": "npx",
      "args": ["omp-mcp"],
      "env": {
        "OMP_SERVER": "http://localhost:3456",
        "OMP_API_KEY": "your-omp-key"
      }
    }
  }
}
```

To enable AI-powered memory extraction and compression, also set these on the server:

```bash
OMP_AI_PROVIDER=anthropic   # or "openai"
OMP_AI_API_KEY=sk-ant-...   # your Anthropic or OpenAI key
```

### 3. Make Claude use OMP automatically

Without a system prompt, you have to ask Claude to use OMP tools manually. To make it automatic, create a **Project** in Claude Desktop and add this system prompt:

```
You have access to OMP memory tools (omp_remember, omp_recall, omp_list).

At the start of every conversation, use omp_recall to search for memories 
relevant to what the user is asking about.

Whenever the user shares anything worth remembering — preferences, decisions, 
projects, facts about themselves — automatically use omp_remember to save it 
without being asked.

Never tell the user you are saving a memory. Just do it silently.
```

This makes OMP invisible — Claude just remembers, automatically, across every session.

### 4. Continue a conversation in a different AI tool — automatically

The **OMP Bridge browser extension** makes this seamless. No copying JSON, no manual steps.

**How it works:**

1. Chat with ChatGPT about anything
2. The extension silently saves your conversation to your OMP server every 2 minutes
3. Open Claude.ai (or any other AI) to start a new chat
4. A toast notification appears: **"Continue from ChatGPT? [topic]"**
5. Click **"Continue in Claude"** — OMP generates a natural handoff brief and injects it
6. Claude responds as if it was in the conversation the whole time

You can also save manually at any point: click the OMP Bridge extension icon → **"Save this conversation to OMP"**.

The handoff brief (AI-generated) looks like:

```
We were exploring MCP (Model Context Protocol) with ChatGPT — specifically what it
is, how it compares to function calling, and why it's more portable across providers.
I'm ready to go deeper on real-world implementations. Can you show me how to build
an MCP server from scratch?
```

**API — save and replay conversations programmatically:**

```bash
# Save a conversation
curl -X POST http://localhost:3456/v1/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chatgpt",
    "topic": "MCP deep dive",
    "messages": [
      {"role": "user", "content": "Tell me about MCP"},
      {"role": "assistant", "content": "MCP stands for..."}
    ]
  }'

# Generate a handoff brief for another model
curl -X POST http://localhost:3456/v1/handoff \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv_abc123",
    "target_model": "claude"
  }'
# → { "brief": "We were exploring MCP with ChatGPT...", "topic": "...", "source_model": "chatgpt" }
```

### Write a memory from any tool

```bash
curl -X POST http://localhost:3456/v1/memories \
  -H "Content-Type: application/json" \
  -d '{
    "content": "User prefers TypeScript over JavaScript and dislikes verbose comments",
    "type": "semantic",
    "source": { "tool": "claude" },
    "tags": ["preferences", "coding"]
  }'
```

### Query from any other tool

```bash
curl "http://localhost:3456/v1/memories/search?q=coding+preferences"
```

---

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Claude    │     │   Cursor    │     │  Your Agent │
│  (MCP)      │     │  (SDK)      │     │  (REST API) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  ┌────────▼────────┐
                  │   OMP Server    │
                  │  (self-hosted)  │
                  │                 │
                  │  ┌───────────┐  │
                  │  │  SQLite   │  │
                  │  │  / Pgvec  │  │
                  │  └───────────┘  │
                  └─────────────────┘
```

Every tool reads and writes to a single OMP server you control. One memory store. All tools. Zero silos.

---

## The Spec

OMP defines:

- **Memory Object** — the canonical schema for a memory (content, type, source, tags, timestamps, optional embedding)
- **Memory Types** — `episodic` (events), `semantic` (facts/preferences), `procedural` (how-to knowledge)
- **REST API** — standard CRUD + semantic search endpoints
- **Authentication** — bearer token, per-tool API keys
- **Export/Import** — portable JSON format for moving memories between servers

Read the full specification: [SPEC.md](SPEC.md)

---

## Memory Object

```json
{
  "id": "mem_01j9xk2p3q4r5s6t",
  "content": "User is building a fintech startup, prefers clean architecture, dislikes over-engineering",
  "type": "semantic",
  "source": {
    "tool": "claude",
    "session_id": "sess_abc123",
    "timestamp": "2026-06-29T12:00:00Z"
  },
  "tags": ["profile", "preferences", "engineering"],
  "created_at": "2026-06-29T12:00:00Z",
  "updated_at": "2026-06-29T12:00:00Z",
  "expires_at": null
}
```

---

## Adapters

| Tool | Status | How |
|------|--------|-----|
| Claude Desktop | ✅ Working | MCP adapter — automatic memory save/recall |
| Claude.ai (web) | ✅ Working | OMP Bridge extension — handoff toast on new chat |
| ChatGPT (web) | ✅ Working | OMP Bridge extension — reads DOM, saves conversation |
| Gemini (web) | ✅ Working | OMP Bridge extension |
| Perplexity (web) | ✅ Working | OMP Bridge extension |
| Claude Code (CLI) | ✅ Working | `claude mcp add omp-mcp` — same MCP tools |
| Cursor | ✅ Working | `omp inject --for cursor` — writes `.cursorrules` |
| GitHub Copilot | ✅ Working | `omp inject --for copilot` — writes `.github/copilot-instructions.md` |
| Codex CLI | ✅ Working | `omp inject --for codex` — writes `AGENTS.md` |
| Any AI CLI | ✅ Working | `omp context \| <cli>` or `omp save` |
| Mobile (PWA) | ✅ Working | Open `http://YOUR_PC_IP:3456/app` on phone — bookmark it |
| Mobile (iOS Shortcut) | ✅ Working | One tap → copies OMP context → paste into any app |
| Remote / cloud | ✅ Working | Deploy to Railway / fly.io / Docker — see [adapters/mobile](adapters/mobile) |
| Custom (REST) | ✅ Available | Any HTTP client |

### AI Coding Tools (Claude Code, Cursor, Copilot, Codex CLI)

Install the `omp` CLI:

```bash
npm install -g omp-cli
```

**Claude Code** (VS Code or terminal) — full MCP integration:
```bash
omp setup claude-code   # prints the exact command to run
# then run:
claude mcp add omp -- npx omp-mcp
```
Claude Code gets `omp_remember`, `omp_recall`, `omp_compress` as tools — same as Claude Desktop.

**Cursor** — injects memories into `.cursorrules`:
```bash
omp inject --for cursor   # run this in your project folder
# Cursor reads .cursorrules automatically on every chat
```

**GitHub Copilot** — injects memories into `.github/copilot-instructions.md`:
```bash
omp inject --for copilot
```

**OpenAI Codex CLI** — injects into `AGENTS.md` (auto-read by Codex):
```bash
omp inject --for codex && codex
# OR pipe directly:
codex --instructions "$(omp context)"
```

**Continue.dev** and any other CLI:
```bash
omp context | <your-ai-cli>   # pipe memories as context
omp handoff --from chatgpt    # continue a web conversation in a CLI
```

**Cross-tool handoff (web → CLI or CLI → web):**
```bash
# ChatGPT → Claude Code
claude "$(omp handoff --from chatgpt)"

# Claude.ai → Codex
codex --instructions "$(omp handoff --from claude)"

# Save any CLI session back to OMP
omp save --model codex < session.txt
```

### OMP Bridge — Browser Extension

The browser extension brings OMP to the **web versions** of every AI tool with zero setup on their side.

**What it does:**
- Shows a floating 🧠 button on Claude.ai, ChatGPT, Gemini, and Perplexity
- Displays your OMP memories from your server
- One click to inject your memories into any chat — the AI instantly knows your context
- Works cross-model: inject the same memories into ChatGPT that Claude saved

**Install (Chrome / Edge / Brave):**
```bash
cd adapters/browser-extension
npm install && npm run build
```
Then open `chrome://extensions` → Enable **Developer mode** → **Load unpacked** → select the `adapters/browser-extension` folder.

**Want to build one?** An adapter is typically 100–200 lines — read [`CONTRIBUTING.md`](CONTRIBUTING.md) and use [`adapters/claude-mcp`](adapters/claude-mcp) as a template.

---

## SDKs

The OMP API is plain REST — any HTTP client works out of the box. Typed SDKs are on the roadmap.

**Want to build one?** Python, Go, Rust, and Ruby SDKs are all needed. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

### REST (any language)

```bash
# Save a memory
curl -X POST http://localhost:3456/v1/memories \
  -H "Content-Type: application/json" \
  -d '{"content":"User prefers TypeScript","type":"semantic","source":{"tool":"myapp","timestamp":"2026-06-30T00:00:00Z"}}'

# Search memories
curl -X POST http://localhost:3456/v1/memories/search \
  -H "Content-Type: application/json" \
  -d '{"q":"TypeScript","limit":5}'
```

---

## Why Open Source?

Your memories are yours. They should not be locked inside a company's database, used to train models without your consent, or lost when you switch tools.

OMP is designed on these principles:

- **Self-hosted first** — you run the server, you own the data
- **Vendor neutral** — no company controls the standard
- **Privacy by design** — memories never leave your server unless you export them
- **Portable** — import/export your full memory in one command

---

## Roadmap

- [x] v0.1 — Core spec, reference server, MCP adapter
- [x] v0.2 — AI memory extraction, conversation compression, MCP resources + prompts
- [x] v0.3 — Cross-model conversation handoff (browser extension + `/v1/conversations` + `/v1/handoff`)
- [x] v0.4 — Mobile PWA, iOS Shortcut, remote hosting (Railway / fly.io / Docker)
- [ ] v0.4 — Semantic search with embeddings, pgvector support
- [ ] v0.5 — Memory namespacing (per-project memories)
- [ ] v0.6 — Multi-user support, access control
- [ ] v1.0 — Stable spec, submitted to open standards body

---

## Contributing

OMP is community-driven. We need:
- **Adapter builders** — connect your favourite AI tool
- **SDK contributors** — Go, Rust, Java SDKs welcome
- **Spec reviewers** — read [SPEC.md](SPEC.md) and open issues
- **Early adopters** — try it and report what breaks

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

## Community

- **GitHub Discussions** — questions, ideas, feedback
- **Issues** — bugs and spec clarifications

---

## License

Apache 2.0 — free to use, modify, and distribute. See [LICENSE](LICENSE).

Built by [SMJAI](https://github.com/SMJAI) and contributors.
