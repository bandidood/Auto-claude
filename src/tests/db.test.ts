import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

// Use an in-memory DB for tests to avoid touching the real store
function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT,
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='id')
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      last_run INTEGER,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      created_at INTEGER NOT NULL
    )
  `)

  return db
}

describe('sessions table', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
  })

  it('can insert and retrieve a session', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, ?)').run('chat1', 'session-abc', now)
    const row = db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get('chat1') as { session_id: string } | undefined
    expect(row?.session_id).toBe('session-abc')
  })

  it('can update a session', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, ?)').run('chat1', 'session-old', now)
    db.prepare('UPDATE sessions SET session_id = ?, updated_at = ? WHERE chat_id = ?').run('session-new', now, 'chat1')
    const row = db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get('chat1') as { session_id: string } | undefined
    expect(row?.session_id).toBe('session-new')
  })

  it('can delete a session', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO sessions (chat_id, session_id, updated_at) VALUES (?, ?, ?)').run('chat1', 'session-abc', now)
    db.prepare('DELETE FROM sessions WHERE chat_id = ?').run('chat1')
    const row = db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get('chat1')
    expect(row).toBeUndefined()
  })
})

describe('memories table', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
  })

  it('can insert a semantic memory', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO memories (chat_id, content, sector, salience, created_at, accessed_at) VALUES (?,?,?,?,?,?)').run('chat1', 'I prefer dark mode', 'semantic', 1.0, now, now)
    const row = db.prepare('SELECT * FROM memories WHERE chat_id = ?').get('chat1') as { content: string; sector: string } | undefined
    expect(row?.content).toBe('I prefer dark mode')
    expect(row?.sector).toBe('semantic')
  })

  it('rejects invalid sector value', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(() => {
      db.prepare('INSERT INTO memories (chat_id, content, sector, salience, created_at, accessed_at) VALUES (?,?,?,?,?,?)').run('chat1', 'test', 'invalid', 1.0, now, now)
    }).toThrow()
  })

  it('can query memories by salience', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO memories (chat_id, content, sector, salience, created_at, accessed_at) VALUES (?,?,?,?,?,?)').run('chat1', 'high salience', 'semantic', 5.0, now, now)
    db.prepare('INSERT INTO memories (chat_id, content, sector, salience, created_at, accessed_at) VALUES (?,?,?,?,?,?)').run('chat1', 'low salience', 'episodic', 0.2, now, now)
    const rows = db.prepare('SELECT * FROM memories WHERE chat_id = ? ORDER BY salience DESC').all('chat1') as Array<{ content: string }>
    expect(rows[0].content).toBe('high salience')
    expect(rows[1].content).toBe('low salience')
  })
})

describe('scheduled_tasks table', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
  })

  it('can create and retrieve a task', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, status, created_at) VALUES (?,?,?,?,?,?,?)').run('task-1', 'chat1', 'Check emails', '0 9 * * *', now + 3600, 'active', now)
    const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get('task-1') as { prompt: string; status: string } | undefined
    expect(row?.prompt).toBe('Check emails')
    expect(row?.status).toBe('active')
  })

  it('returns due tasks', () => {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, status, created_at) VALUES (?,?,?,?,?,?,?)').run('task-due', 'chat1', 'Due task', '0 9 * * *', now - 60, 'active', now)
    db.prepare('INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, status, created_at) VALUES (?,?,?,?,?,?,?)').run('task-future', 'chat1', 'Future task', '0 9 * * *', now + 3600, 'active', now)
    const due = db.prepare('SELECT * FROM scheduled_tasks WHERE status = ? AND next_run <= ?').all('active', now) as Array<{ id: string }>
    expect(due).toHaveLength(1)
    expect(due[0].id).toBe('task-due')
  })
})
