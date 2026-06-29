# Open Memory Protocol — Specification v0.1

**Status:** Draft  
**Author:** SMJAI  
**Date:** 2026-06-29  
**License:** Apache 2.0

---

## 1. Introduction

The Open Memory Protocol (OMP) defines a standard interface for AI tools to store, retrieve, and share memory about users and their context.

### 1.1 Goals

- Enable AI memory to be **portable** across tools, sessions, and devices
- Provide a **vendor-neutral** standard no single company controls
- Keep the user in **full control** of their own memory data
- Be **simple enough** that any AI tool can implement it in a day

### 1.2 Non-Goals

- OMP does not define how AI tools *use* memory internally
- OMP does not define model training or fine-tuning
- OMP does not define encryption at rest (left to implementations)

### 1.3 Terminology

- **Memory** — a discrete, human-readable unit of context about a user or their work
- **OMP Server** — a service that stores and serves memories via the OMP API
- **OMP Client** — any AI tool or agent that reads/writes memories via the OMP API
- **Tool** — the AI application writing or reading a memory (e.g. "claude", "cursor")

---

## 2. Memory Object

A **Memory** is the core data structure of OMP. All operations revolve around it.

### 2.1 Schema

```typescript
interface Memory {
  // Identity
  id: string                  // Unique ID, format: "mem_" + 16 char alphanumeric
  
  // Content
  content: string             // The memory text. Plain natural language. Max 10,000 chars.
  type: MemoryType            // Classification of memory (see §2.2)
  
  // Provenance
  source: MemorySource        // Where this memory came from (see §2.3)
  
  // Organisation
  tags: string[]              // Arbitrary tags for filtering. Max 20 tags, 50 chars each.
  namespace?: string          // Optional grouping (e.g. "project:myapp"). Max 100 chars.
  
  // Lifecycle
  created_at: string          // ISO 8601 UTC timestamp
  updated_at: string          // ISO 8601 UTC timestamp
  expires_at: string | null   // ISO 8601 UTC or null (never expires)
  
  // Optional semantic search support
  embedding?: number[]        // Vector embedding of content (implementation-defined dimensions)
  
  // Catch-all for tool-specific data
  metadata?: Record<string, unknown>  // Max 10 keys, values must be JSON-serialisable
}
```

### 2.2 Memory Types

| Type | Description | Examples |
|------|-------------|---------|
| `episodic` | A specific event or interaction that occurred | "User deployed to prod on 2026-06-01 and it failed"; "User asked about Python async yesterday" |
| `semantic` | A fact, preference, or general knowledge about the user | "User prefers TypeScript over JavaScript"; "User is a senior engineer at a fintech startup" |
| `procedural` | A process or workflow the user follows | "User always runs tests before committing"; "User's deploy process: build → lint → test → push" |

### 2.3 Memory Source

```typescript
interface MemorySource {
  tool: string        // Identifier of the tool that created this memory. e.g. "claude", "cursor", "gpt-4o"
  session_id?: string // Optional session/conversation ID from the source tool
  user_id?: string    // Optional user identifier within the source tool
  timestamp: string   // ISO 8601 UTC — when this memory was observed (may differ from created_at)
}
```

---

## 3. API

The OMP API is a REST API over HTTP/HTTPS. All request and response bodies are JSON.

### 3.1 Base URL

```
http(s)://<host>:<port>/v1
```

### 3.2 Authentication

OMP uses Bearer token authentication.

```
Authorization: Bearer <api-key>
```

Implementations MUST support at minimum one global API key. Implementations MAY support per-tool API keys that restrict read/write access by `source.tool`.

### 3.3 Endpoints

#### `POST /v1/memories`
Create a new memory.

**Request body:**
```json
{
  "content": "User prefers dark mode and minimal UI",
  "type": "semantic",
  "source": {
    "tool": "claude",
    "timestamp": "2026-06-29T12:00:00Z"
  },
  "tags": ["ui", "preferences"],
  "namespace": "project:myapp",
  "expires_at": null,
  "metadata": {}
}
```

**Response `201 Created`:**
```json
{
  "id": "mem_01j9xk2p3q4r5s6t",
  "content": "User prefers dark mode and minimal UI",
  "type": "semantic",
  "source": {
    "tool": "claude",
    "timestamp": "2026-06-29T12:00:00Z"
  },
  "tags": ["ui", "preferences"],
  "namespace": "project:myapp",
  "created_at": "2026-06-29T12:00:00Z",
  "updated_at": "2026-06-29T12:00:00Z",
  "expires_at": null,
  "metadata": {}
}
```

---

#### `GET /v1/memories`
List memories with optional filters.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Filter by memory type |
| `tool` | string | Filter by source tool |
| `tags` | string | Comma-separated tags (AND logic) |
| `namespace` | string | Filter by namespace |
| `limit` | integer | Max results (default 20, max 100) |
| `offset` | integer | Pagination offset |
| `sort` | string | `created_at_desc` (default), `created_at_asc`, `updated_at_desc` |

**Response `200 OK`:**
```json
{
  "memories": [...],
  "total": 142,
  "limit": 20,
  "offset": 0
}
```

---

#### `GET /v1/memories/:id`
Retrieve a single memory by ID.

**Response `200 OK`:** Memory object  
**Response `404 Not Found`:** `{ "error": "memory_not_found" }`

---

#### `PUT /v1/memories/:id`
Update an existing memory. All fields are optional — only provided fields are updated.

**Request body:** Partial Memory object (excluding `id`, `created_at`)

**Response `200 OK`:** Updated Memory object

---

#### `DELETE /v1/memories/:id`
Delete a memory.

**Response `204 No Content`**  
**Response `404 Not Found`:** `{ "error": "memory_not_found" }`

---

#### `POST /v1/memories/search`
Semantic or keyword search across memories.

**Request body:**
```json
{
  "q": "coding preferences",
  "type": "semantic",
  "tags": ["preferences"],
  "namespace": "project:myapp",
  "limit": 10,
  "mode": "keyword"
}
```

**`mode` values:**
- `keyword` — full-text keyword search (MUST be supported by all implementations)
- `semantic` — vector similarity search (OPTIONAL, requires embeddings)
- `hybrid` — combined keyword + semantic (OPTIONAL)

**Response `200 OK`:**
```json
{
  "memories": [...],
  "total": 3,
  "mode_used": "keyword"
}
```

---

#### `GET /v1/export`
Export all memories as a portable JSON file.

**Response `200 OK`:**
```json
{
  "omp_version": "0.1",
  "exported_at": "2026-06-29T12:00:00Z",
  "server": "omp-reference-server",
  "memories": [...]
}
```

---

#### `POST /v1/import`
Import memories from an OMP export file.

**Request body:** OMP export JSON object

**`conflict` strategies (query param):**
- `skip` — skip memories whose ID already exists (default)
- `overwrite` — overwrite existing memories
- `duplicate` — always create new IDs

**Response `200 OK`:**
```json
{
  "imported": 142,
  "skipped": 3,
  "errors": []
}
```

---

#### `GET /v1/health`
Server health check. No authentication required.

**Response `200 OK`:**
```json
{
  "status": "ok",
  "version": "0.1",
  "memories_count": 142
}
```

---

## 4. Error Format

All errors use a consistent envelope:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "details": {}
}
```

**Standard error codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthorized` | 401 | Missing or invalid API key |
| `forbidden` | 403 | Valid key but insufficient permission |
| `memory_not_found` | 404 | Memory ID does not exist |
| `validation_error` | 422 | Request body failed schema validation |
| `rate_limited` | 429 | Too many requests |
| `internal_error` | 500 | Server-side failure |

---

## 5. Compliance Levels

Implementations declare their compliance level in `/v1/health`:

| Level | Requirements |
|-------|-------------|
| **OMP-Core** | All CRUD endpoints, keyword search, export/import, bearer auth |
| **OMP-Search** | OMP-Core + semantic search with embeddings |
| **OMP-Full** | OMP-Search + namespacing, per-tool API keys, multi-user support |

---

## 6. Versioning

The API is versioned via the URL path (`/v1/`). Breaking changes increment the version.

The spec version is independent of server implementation versions. A server may implement multiple spec versions simultaneously.

---

## 7. Security Considerations

- Implementations MUST use HTTPS in production
- API keys MUST be at least 32 characters of cryptographic randomness
- Implementations SHOULD rate-limit per API key
- Implementations SHOULD log all write operations for audit purposes
- Memory content MUST NOT be logged in plain text in production logs

---

## 8. Conformance

An implementation is OMP-Core conformant if it:

1. Implements all endpoints in §3.3 with correct HTTP methods and status codes
2. Returns responses matching the schemas in §2.1 and §3.3
3. Supports keyword search (`mode: "keyword"`) in `POST /v1/memories/search`
4. Supports export and import via `GET /v1/export` and `POST /v1/import`
5. Implements Bearer token authentication as described in §3.2
6. Returns errors in the format described in §4

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-06-29 | Initial draft |
