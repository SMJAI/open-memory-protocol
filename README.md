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

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

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

| Tool | Status | Install |
|------|--------|---------|
| Claude (MCP) | ✅ Available | `npx omp-mcp` |
| OpenAI Assistants | 🙋 Help wanted | [Open issue](https://github.com/SMJAI/open-memory-protocol/issues) |
| Cursor | 🙋 Help wanted | [Open issue](https://github.com/SMJAI/open-memory-protocol/issues) |
| Copilot / VS Code | 🙋 Help wanted | [Open issue](https://github.com/SMJAI/open-memory-protocol/issues) |
| Gemini | 🙋 Help wanted | [Open issue](https://github.com/SMJAI/open-memory-protocol/issues) |
| Custom (REST) | ✅ Available | Any HTTP client |

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
- [ ] v0.3 — Semantic search with embeddings, pgvector support
- [ ] v0.4 — Memory namespacing (per-project memories)
- [ ] v0.5 — Multi-user support, access control
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
