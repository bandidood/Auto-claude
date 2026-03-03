import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { PROJECT_ROOT, TYPING_REFRESH_MS } from './config.js'
import { logger } from './logger.js'

export interface AgentResult {
  text: string | null
  newSessionId?: string
}

export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void
): Promise<AgentResult> {
  let responseText: string | null = null
  let newSessionId: string | undefined

  // Typing keep-alive interval
  let typingInterval: ReturnType<typeof setInterval> | null = null
  if (onTyping) {
    typingInterval = setInterval(() => {
      onTyping()
    }, TYPING_REFRESH_MS)
  }

  try {
    const options: Options = {
      cwd: PROJECT_ROOT,
      settingSources: ['project', 'user'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    }

    if (sessionId) {
      options.resume = sessionId
    }

    const stream = query({ prompt: message, options })

    for await (const event of stream) {
      if (event.type === 'system' && event.subtype === 'init') {
        newSessionId = event.session_id
      } else if (event.type === 'result' && event.subtype === 'success') {
        responseText = event.result ?? null
      }
    }
  } catch (err) {
    logger.error({ err }, 'runAgent error')
    throw err
  } finally {
    if (typingInterval !== null) {
      clearInterval(typingInterval)
    }
  }

  return { text: responseText, newSessionId }
}
