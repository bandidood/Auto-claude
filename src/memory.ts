import {
  insertMemory,
  searchMemoriesFts,
  getRecentMemories,
  touchMemory,
  decayMemories as dbDecayMemories,
} from './db.js'
import { logger } from './logger.js'

const SEMANTIC_PATTERN = /\b(my|i am|i'm|i prefer|remember|always|never)\b/i

function sanitizeFtsQuery(text: string): string {
  // Strip non-alphanumeric except spaces, then add wildcard
  const cleaned = text.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, ' ').trim()
  const words = cleaned.split(/\s+/).filter(w => w.length > 2).slice(0, 8)
  if (words.length === 0) return ''
  return words.map(w => `${w}*`).join(' OR ')
}

export async function buildMemoryContext(
  chatId: string,
  userMessage: string
): Promise<string> {
  try {
    const results: Map<number, { id: number; content: string; sector: string; salience: number }> = new Map()

    // FTS5 semantic search
    const ftsQuery = sanitizeFtsQuery(userMessage)
    if (ftsQuery) {
      const ftsResults = searchMemoriesFts(chatId, ftsQuery, 3)
      for (const row of ftsResults) {
        results.set(row.id, row)
      }
    }

    // Recent memories
    const recent = getRecentMemories(chatId, 5)
    for (const row of recent) {
      results.set(row.id, row)
    }

    if (results.size === 0) return ''

    // Touch each found memory
    for (const { id } of results.values()) {
      touchMemory(id)
    }

    const lines = Array.from(results.values())
      .map(m => `- ${m.content} (${m.sector})`)
      .join('\n')

    return `[Memory context]\n${lines}`
  } catch (err) {
    logger.warn({ err }, 'buildMemoryContext failed, skipping')
    return ''
  }
}

export async function saveConversationTurn(
  chatId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  // Skip very short messages and commands
  if (userMsg.length <= 20 || userMsg.startsWith('/')) return

  const isSemanticUser = SEMANTIC_PATTERN.test(userMsg)
  const isSemanticAssistant = SEMANTIC_PATTERN.test(assistantMsg)

  // Save user message
  insertMemory(
    chatId,
    `User said: ${userMsg.slice(0, 300)}`,
    isSemanticUser ? 'semantic' : 'episodic'
  )

  // Save assistant response (only if meaningful)
  if (assistantMsg.length > 30) {
    insertMemory(
      chatId,
      `Assistant replied: ${assistantMsg.slice(0, 300)}`,
      isSemanticAssistant ? 'semantic' : 'episodic'
    )
  }
}

export function runDecaySweep(): void {
  try {
    dbDecayMemories()
    logger.debug('Memory decay sweep complete')
  } catch (err) {
    logger.warn({ err }, 'Memory decay sweep failed')
  }
}
