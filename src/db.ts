import Database from 'better-sqlite3'
import path from 'path'
import { STORE_DIR } from './config.js'

const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function initDatabase(): void {
  const db = getDb()

  // Sessions table (always required)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // Full memory tables
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
    );

    CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id);
    CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `)

  // Scheduled tasks table
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
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status_next ON scheduled_tasks(status, next_run);
  `)

  // WhatsApp tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      wa_contact TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_chat_id TEXT NOT NULL,
      wa_contact TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      body TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_message_map (
      telegram_chat_id TEXT NOT NULL,
      wa_chat_id TEXT NOT NULL,
      PRIMARY KEY (telegram_chat_id)
    );
  `)
}

// ─── Sessions ──────────────────────────────────────────────────────────────

export function getSession(chatId: string): string | null {
  const row = getDb()
    .prepare('SELECT session_id FROM sessions WHERE chat_id = ?')
    .get(chatId) as { session_id: string } | undefined
  return row?.session_id ?? null
}

export function setSession(chatId: string, sessionId: string): void {
  getDb()
    .prepare(`
      INSERT INTO sessions (chat_id, session_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
    `)
    .run(chatId, sessionId, Math.floor(Date.now() / 1000))
}

export function clearSession(chatId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId)
}

// ─── Memories ──────────────────────────────────────────────────────────────

export function insertMemory(
  chatId: string,
  content: string,
  sector: 'semantic' | 'episodic',
  topicKey?: string
): void {
  const now = Math.floor(Date.now() / 1000)
  getDb()
    .prepare(`
      INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at)
      VALUES (?, ?, ?, ?, 1.0, ?, ?)
    `)
    .run(chatId, topicKey ?? null, content, sector, now, now)
}

export function searchMemoriesFts(
  chatId: string,
  query: string,
  limit = 3
): Array<{ id: number; content: string; sector: string; salience: number }> {
  return getDb()
    .prepare(`
      SELECT m.id, m.content, m.sector, m.salience
      FROM memories m
      JOIN memories_fts fts ON fts.rowid = m.id
      WHERE fts.content MATCH ?
        AND m.chat_id = ?
      ORDER BY rank
      LIMIT ?
    `)
    .all(query, chatId, limit) as Array<{ id: number; content: string; sector: string; salience: number }>
}

export function getRecentMemories(
  chatId: string,
  limit = 5
): Array<{ id: number; content: string; sector: string; salience: number }> {
  return getDb()
    .prepare(`
      SELECT id, content, sector, salience
      FROM memories
      WHERE chat_id = ?
      ORDER BY accessed_at DESC
      LIMIT ?
    `)
    .all(chatId, limit) as Array<{ id: number; content: string; sector: string; salience: number }>
}

export function touchMemory(id: number): void {
  const now = Math.floor(Date.now() / 1000)
  getDb()
    .prepare(`
      UPDATE memories
      SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0)
      WHERE id = ?
    `)
    .run(now, id)
}

export function decayMemories(): void {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400
  getDb()
    .prepare(`UPDATE memories SET salience = salience * 0.98 WHERE created_at < ?`)
    .run(oneDayAgo)
  getDb()
    .prepare(`DELETE FROM memories WHERE salience < 0.1`)
    .run()
}

export function getAllMemories(
  chatId: string
): Array<{ id: number; content: string; sector: string; salience: number; accessed_at: number }> {
  return getDb()
    .prepare(`
      SELECT id, content, sector, salience, accessed_at
      FROM memories
      WHERE chat_id = ?
      ORDER BY accessed_at DESC
      LIMIT 20
    `)
    .all(chatId) as Array<{ id: number; content: string; sector: string; salience: number; accessed_at: number }>
}

export function clearMemories(chatId: string): void {
  getDb().prepare('DELETE FROM memories WHERE chat_id = ?').run(chatId)
}

// ─── Scheduled Tasks ───────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string
  chat_id: string
  prompt: string
  schedule: string
  next_run: number
  last_run: number | null
  last_result: string | null
  status: 'active' | 'paused'
  created_at: number
}

export function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void {
  getDb()
    .prepare(`
      INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(task.id, task.chat_id, task.prompt, task.schedule, task.next_run, task.status, task.created_at)
}

export function getDueTasks(now: number): ScheduledTask[] {
  return getDb()
    .prepare(`
      SELECT * FROM scheduled_tasks
      WHERE status = 'active' AND next_run <= ?
    `)
    .all(now) as ScheduledTask[]
}

export function getAllTasks(): ScheduledTask[] {
  return getDb()
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[]
}

export function updateTaskAfterRun(id: string, result: string, nextRun: number): void {
  const now = Math.floor(Date.now() / 1000)
  getDb()
    .prepare(`
      UPDATE scheduled_tasks
      SET last_run = ?, last_result = ?, next_run = ?
      WHERE id = ?
    `)
    .run(now, result, nextRun, id)
}

export function setTaskStatus(id: string, status: 'active' | 'paused'): void {
  getDb()
    .prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?')
    .run(status, id)
}

export function deleteTask(id: string): void {
  getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

// ─── WhatsApp ──────────────────────────────────────────────────────────────

export function enqueueWaMessage(chatId: string, waContact: string, message: string): void {
  const now = Math.floor(Date.now() / 1000)
  getDb()
    .prepare(`
      INSERT INTO wa_outbox (chat_id, wa_contact, message, created_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(chatId, waContact, message, now)
}

export function getPendingWaMessages(): Array<{
  id: number; chat_id: string; wa_contact: string; message: string
}> {
  return getDb()
    .prepare(`SELECT id, chat_id, wa_contact, message FROM wa_outbox WHERE sent_at IS NULL`)
    .all() as Array<{ id: number; chat_id: string; wa_contact: string; message: string }>
}

export function markWaMessageSent(id: number): void {
  const now = Math.floor(Date.now() / 1000)
  getDb()
    .prepare('UPDATE wa_outbox SET sent_at = ? WHERE id = ?')
    .run(now, id)
}

export function saveWaMessage(
  waChatId: string,
  waContact: string,
  direction: 'in' | 'out',
  body: string,
  timestamp: number
): void {
  getDb()
    .prepare(`
      INSERT INTO wa_messages (wa_chat_id, wa_contact, direction, body, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(waChatId, waContact, direction, body, timestamp)
}

export function getWaMapping(telegramChatId: string): string | null {
  const row = getDb()
    .prepare('SELECT wa_chat_id FROM wa_message_map WHERE telegram_chat_id = ?')
    .get(telegramChatId) as { wa_chat_id: string } | undefined
  return row?.wa_chat_id ?? null
}

export function setWaMapping(telegramChatId: string, waChatId: string): void {
  getDb()
    .prepare(`
      INSERT INTO wa_message_map (telegram_chat_id, wa_chat_id)
      VALUES (?, ?)
      ON CONFLICT(telegram_chat_id) DO UPDATE SET wa_chat_id = excluded.wa_chat_id
    `)
    .run(telegramChatId, waChatId)
}
