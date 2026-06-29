import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import fs from 'fs'
import type { Memory, CreateMemoryInput, UpdateMemoryInput, ListResult, SearchResult } from '../types'

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'mem_'
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

export class SQLiteStorage {
  private db: DatabaseSync

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id          TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        type        TEXT NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural')),
        source_tool TEXT NOT NULL,
        source_session_id TEXT,
        source_user_id    TEXT,
        source_timestamp  TEXT NOT NULL,
        tags        TEXT NOT NULL DEFAULT '[]',
        namespace   TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        expires_at  TEXT,
        metadata    TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_memories_type      ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
      CREATE INDEX IF NOT EXISTS idx_memories_tool      ON memories(source_tool);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        tags,
        content='memories',
        content_rowid='rowid'
      );
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, id, content, tags)
        VALUES (new.rowid, new.id, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, tags)
        VALUES ('delete', old.rowid, old.id, old.content, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, tags)
        VALUES ('delete', old.rowid, old.id, old.content, old.tags);
        INSERT INTO memories_fts(rowid, id, content, tags)
        VALUES (new.rowid, new.id, new.content, new.tags);
      END;
    `)
  }

  private rowToMemory(row: Record<string, unknown>): Memory {
    return {
      id: row.id as string,
      content: row.content as string,
      type: row.type as Memory['type'],
      source: {
        tool: row.source_tool as string,
        session_id: (row.source_session_id as string) ?? undefined,
        user_id: (row.source_user_id as string) ?? undefined,
        timestamp: row.source_timestamp as string,
      },
      tags: JSON.parse(row.tags as string),
      namespace: row.namespace as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      expires_at: row.expires_at as string | null,
      metadata: JSON.parse(row.metadata as string),
    }
  }

  create(input: CreateMemoryInput): Memory {
    const now = new Date().toISOString()
    const id = generateId()

    this.db.prepare(`
      INSERT INTO memories (id, content, type, source_tool, source_session_id, source_user_id,
        source_timestamp, tags, namespace, created_at, updated_at, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.content,
      input.type,
      input.source.tool,
      input.source.session_id ?? null,
      input.source.user_id ?? null,
      input.source.timestamp,
      JSON.stringify(input.tags ?? []),
      input.namespace ?? null,
      now,
      now,
      input.expires_at ?? null,
      JSON.stringify(input.metadata ?? {})
    )

    return this.getById(id)!
  }

  getById(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToMemory(row) : null
  }

  list(opts: { type?: string; tool?: string; tags?: string[]; namespace?: string; limit?: number; offset?: number }): ListResult {
    const conditions: string[] = ['1=1']
    const params: (string | number)[] = []

    if (opts.type) { conditions.push('type = ?'); params.push(opts.type) }
    if (opts.tool) { conditions.push('source_tool = ?'); params.push(opts.tool) }
    if (opts.namespace) { conditions.push('namespace = ?'); params.push(opts.namespace) }

    const where = conditions.join(' AND ')
    const limit = opts.limit ?? 20
    const offset = opts.offset ?? 0

    const rows = this.db.prepare(`SELECT * FROM memories WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[]

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM memories WHERE ${where}`)
      .get(...params) as { count: number }).count

    let memories = rows.map(r => this.rowToMemory(r))

    if (opts.tags && opts.tags.length > 0) {
      memories = memories.filter(m => opts.tags!.every(t => m.tags.includes(t)))
    }

    return { memories, total, limit, offset }
  }

  update(id: string, input: UpdateMemoryInput): Memory | null {
    const existing = this.getById(id)
    if (!existing) return null

    const now = new Date().toISOString()
    const merged = {
      content: input.content ?? existing.content,
      type: input.type ?? existing.type,
      source_tool: input.source?.tool ?? existing.source.tool,
      source_session_id: input.source?.session_id ?? existing.source.session_id ?? null,
      source_user_id: input.source?.user_id ?? existing.source.user_id ?? null,
      source_timestamp: input.source?.timestamp ?? existing.source.timestamp,
      tags: JSON.stringify(input.tags ?? existing.tags),
      namespace: input.namespace ?? existing.namespace,
      expires_at: input.expires_at ?? existing.expires_at,
      metadata: JSON.stringify(input.metadata ?? existing.metadata),
    }

    this.db.prepare(`
      UPDATE memories SET content=?, type=?, source_tool=?, source_session_id=?, source_user_id=?,
        source_timestamp=?, tags=?, namespace=?, updated_at=?, expires_at=?, metadata=? WHERE id=?
    `).run(
      merged.content, merged.type, merged.source_tool, merged.source_session_id,
      merged.source_user_id, merged.source_timestamp, merged.tags, merged.namespace,
      now, merged.expires_at, merged.metadata, id
    )

    return this.getById(id)!
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    return result.changes > 0
  }

  search(input: { q: string; type?: string; namespace?: string; limit?: number }): SearchResult {
    const limit = input.limit ?? 10
    const ftsQuery = input.q.trim().split(/\s+/).map(w => `"${w.replace(/"/g, '')}"`).join(' OR ')

    const extraConditions = [
      ...(input.type ? ['m.type = ?'] : []),
      ...(input.namespace ? ['m.namespace = ?'] : []),
    ]
    const extraWhere = extraConditions.length ? `AND ${extraConditions.join(' AND ')}` : ''
    const params = [ftsQuery, ...(input.type ? [input.type] : []), ...(input.namespace ? [input.namespace] : []), limit]

    const rows = this.db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts f ON m.id = f.id
      WHERE memories_fts MATCH ?
        ${extraWhere}
      ORDER BY rank
      LIMIT ?
    `).all(...params) as Record<string, unknown>[]

    return {
      memories: rows.map(r => this.rowToMemory(r)),
      total: rows.length,
      mode_used: 'keyword',
    }
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count
  }

  exportAll(): Memory[] {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY created_at ASC').all() as Record<string, unknown>[]
    return rows.map(r => this.rowToMemory(r))
  }

  importMany(memories: Memory[], conflict: 'skip' | 'overwrite' | 'duplicate'): { imported: number; skipped: number } {
    let imported = 0
    let skipped = 0

    for (const m of memories) {
      const existing = this.getById(m.id)

      if (existing) {
        if (conflict === 'skip') { skipped++; continue }
        if (conflict === 'overwrite') { this.delete(m.id) }
        if (conflict === 'duplicate') {
          m.id = generateId()
        }
      }

      this.db.prepare(`
        INSERT INTO memories (id, content, type, source_tool, source_session_id, source_user_id,
          source_timestamp, tags, namespace, created_at, updated_at, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        m.id, m.content, m.type, m.source.tool,
        m.source.session_id ?? null, m.source.user_id ?? null, m.source.timestamp,
        JSON.stringify(m.tags), m.namespace ?? null,
        m.created_at, m.updated_at, m.expires_at ?? null,
        JSON.stringify(m.metadata)
      )
      imported++
    }

    return { imported, skipped }
  }
}
