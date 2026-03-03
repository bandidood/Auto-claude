import { Bot, Context, InputFile } from 'grammy'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  TELEGRAM_BOT_TOKEN,
  ALLOWED_CHAT_ID,
  MAX_MESSAGE_LENGTH,
} from './config.js'
import { getSession, setSession, clearSession, getAllMemories } from './db.js'
import { runAgent } from './agent.js'
import { buildMemoryContext, saveConversationTurn } from './memory.js'
import { transcribeAudio, synthesizeSpeech, voiceCapabilities } from './voice.js'
import { downloadMedia, buildPhotoMessage, buildDocumentMessage, buildVideoMessage } from './media.js'
import { getAllTasks, createTask, deleteTask, setTaskStatus } from './db.js'
import { computeNextRun } from './scheduler.js'
import { randomUUID } from 'crypto'
import { enqueueWaMessage, setWaMapping, getWaMapping } from './db.js'
import { getWaChats, getWaMessages, sendWaMessage } from './whatsapp.js'
import { logger } from './logger.js'

// Voice mode per chat
const voiceModeChats = new Set<string>()

// WhatsApp active chat context per telegram chat
const waActiveChatIds = new Map<string, string>()

export function createBot(): Bot {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set. Run npm run setup to configure.')
  }

  const bot = new Bot(TELEGRAM_BOT_TOKEN)

  // ─── Auth check ─────────────────────────────────────────────────────────

  function isAuthorised(chatId: number): boolean {
    if (!ALLOWED_CHAT_ID) return true // first-run mode
    return String(chatId) === ALLOWED_CHAT_ID
  }

  function splitMessage(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= limit) return [text]
    const chunks: string[] = []
    let remaining = text
    while (remaining.length > limit) {
      let cutAt = remaining.lastIndexOf('\n', limit)
      if (cutAt <= 0) cutAt = limit
      chunks.push(remaining.slice(0, cutAt))
      remaining = remaining.slice(cutAt).trimStart()
    }
    if (remaining) chunks.push(remaining)
    return chunks
  }

  // ─── Core handler ────────────────────────────────────────────────────────

  async function handleMessage(
    ctx: Context,
    rawText: string,
    forceVoiceReply = false
  ): Promise<void> {
    const chatId = String(ctx.chat?.id ?? '')
    if (!chatId) return

    let message = rawText

    // Build and prepend memory context
    const memCtx = await buildMemoryContext(chatId, rawText)
    if (memCtx) {
      message = `${memCtx}\n\n[User message]: ${rawText}`
    }

    const sessionId = getSession(chatId) ?? undefined

    // Typing indicator loop
    const sendTyping = () => ctx.replyWithChatAction('typing').catch(() => {})
    sendTyping()
    const typingLoop = setInterval(sendTyping, 4000)

    let responseText = ''
    let newSessionId: string | undefined

    try {
      const result = await runAgent(message, sessionId, sendTyping)
      responseText = result.text ?? '(no response)'
      newSessionId = result.newSessionId
    } catch (err) {
      logger.error({ err }, 'runAgent failed in handleMessage')
      responseText = `Error: ${String(err)}`
    } finally {
      clearInterval(typingLoop)
    }

    // Persist session
    if (newSessionId) {
      setSession(chatId, newSessionId)
    }

    // Save to memory
    await saveConversationTurn(chatId, rawText, responseText)

    // Voice reply?
    const useVoice = forceVoiceReply || voiceModeChats.has(chatId)
    const caps = voiceCapabilities()

    if (useVoice && caps.tts) {
      try {
        const audioBuffer = await synthesizeSpeech(responseText)
        const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`)
        fs.writeFileSync(tmpFile, audioBuffer)
        await ctx.replyWithVoice(new InputFile(tmpFile))
        fs.unlinkSync(tmpFile)
        return
      } catch (err) {
        logger.warn({ err }, 'TTS failed, falling back to text')
      }
    }

    // Text reply
    const formatted = formatForTelegram(responseText)
    const chunks = splitMessage(formatted)
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: 'HTML' })
    }
  }

  // ─── Commands ────────────────────────────────────────────────────────────

  bot.command('start', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    await ctx.reply(
      'ClaudeClaw is running. Send me any message and I\'ll handle it via Claude Code.\n\n' +
      'Commands:\n' +
      '/chatid — your chat ID\n' +
      '/newchat — start fresh session\n' +
      '/memory — show recent memories\n' +
      '/voice — toggle voice replies\n' +
      '/wa — WhatsApp bridge\n' +
      '/schedule — manage scheduled tasks'
    )
  })

  bot.command('chatid', async ctx => {
    await ctx.reply(`Your chat ID: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' })
  })

  bot.command('newchat', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    clearSession(String(ctx.chat.id))
    await ctx.reply('Session cleared. Starting fresh.')
  })

  bot.command('forget', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    clearSession(String(ctx.chat.id))
    await ctx.reply('Session cleared.')
  })

  bot.command('memory', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    const chatId = String(ctx.chat.id)
    const memories = getAllMemories(chatId)
    if (memories.length === 0) {
      await ctx.reply('No memories stored yet.')
      return
    }
    const lines = memories.map(m => {
      const date = new Date(m.accessed_at * 1000).toLocaleDateString()
      return `[${m.sector}] ${m.content.slice(0, 100)} (${date})`
    }).join('\n')
    await ctx.reply(`Recent memories:\n\n${lines}`)
  })

  bot.command('voice', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    const chatId = String(ctx.chat.id)
    const caps = voiceCapabilities()
    if (!caps.tts) {
      await ctx.reply('TTS is not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env')
      return
    }
    if (voiceModeChats.has(chatId)) {
      voiceModeChats.delete(chatId)
      await ctx.reply('Voice replies disabled. Switched to text.')
    } else {
      voiceModeChats.add(chatId)
      await ctx.reply('Voice replies enabled. I\'ll respond with audio.')
    }
  })

  // ─── Scheduler commands ──────────────────────────────────────────────────

  bot.command('schedule', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    const chatId = String(ctx.chat.id)
    const args = ctx.match?.trim() ?? ''

    if (!args || args === 'list') {
      const tasks = getAllTasks()
      if (tasks.length === 0) {
        await ctx.reply('No scheduled tasks. Use /schedule create "prompt" "0 9 * * *" to add one.')
        return
      }
      const lines = tasks.map(t => {
        const next = new Date(t.next_run * 1000).toLocaleString()
        return `[${t.status}] ${t.id.slice(0, 8)}... — "${t.prompt.slice(0, 40)}" — next: ${next}`
      }).join('\n')
      await ctx.reply(`Scheduled tasks:\n\n${lines}`)
      return
    }

    const createMatch = args.match(/^create\s+"(.+?)"\s+"(.+?)"$/)
    if (createMatch) {
      const [, prompt, cron] = createMatch
      try {
        const nextRun = computeNextRun(cron)
        const id = randomUUID()
        createTask({
          id, chat_id: chatId, prompt, schedule: cron,
          next_run: nextRun, status: 'active',
          created_at: Math.floor(Date.now() / 1000),
        })
        await ctx.reply(`Task created: ${id.slice(0, 8)}...\nNext run: ${new Date(nextRun * 1000).toLocaleString()}`)
      } catch {
        await ctx.reply('Invalid cron expression. Example: "0 9 * * *" for daily at 9am')
      }
      return
    }

    const deleteMatch = args.match(/^delete\s+(\S+)/)
    if (deleteMatch) {
      deleteTask(deleteMatch[1])
      await ctx.reply(`Task deleted: ${deleteMatch[1]}`)
      return
    }

    const pauseMatch = args.match(/^(pause|resume)\s+(\S+)/)
    if (pauseMatch) {
      const status = pauseMatch[1] === 'pause' ? 'paused' : 'active'
      setTaskStatus(pauseMatch[2], status)
      await ctx.reply(`Task ${status}: ${pauseMatch[2]}`)
      return
    }

    await ctx.reply(
      'Schedule commands:\n' +
      '/schedule list\n' +
      '/schedule create "daily summary" "0 9 * * *"\n' +
      '/schedule delete <id>\n' +
      '/schedule pause <id>\n' +
      '/schedule resume <id>'
    )
  })

  // ─── WhatsApp commands ───────────────────────────────────────────────────

  bot.command('wa', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    const chatId = String(ctx.chat.id)
    const args = ctx.match?.trim() ?? ''

    if (!args || args === 'list') {
      const chats = await getWaChats()
      if (chats.length === 0) {
        await ctx.reply('No WhatsApp chats found. Make sure WhatsApp is connected.')
        return
      }
      const lines = chats.map((c, i) => `${i + 1}. ${c.name} (${c.id})`).join('\n')
      await ctx.reply(`WhatsApp chats:\n\n${lines}\n\nUse /wa read <chat_id> or /wa reply <chat_id> <message>`)
      return
    }

    const readMatch = args.match(/^read\s+(\S+)/)
    if (readMatch) {
      const waChatId = readMatch[1]
      setWaMapping(chatId, waChatId)
      waActiveChatIds.set(chatId, waChatId)
      const messages = await getWaMessages(waChatId, 10)
      if (messages.length === 0) {
        await ctx.reply('No messages found.')
        return
      }
      const lines = messages.map(m => {
        const time = new Date(m.timestamp * 1000).toLocaleTimeString()
        return `[${time}] ${m.from}: ${m.body}`
      }).join('\n')
      await ctx.reply(`Last messages:\n\n${lines}\n\nReply with /wa send <message>`)
      return
    }

    const sendMatch = args.match(/^send\s+(.+)/)
    if (sendMatch) {
      const activeChat = waActiveChatIds.get(chatId) ?? getWaMapping(chatId)
      if (!activeChat) {
        await ctx.reply('No active WhatsApp chat. Use /wa read <chat_id> first.')
        return
      }
      const message = sendMatch[1]
      try {
        await sendWaMessage(activeChat, message)
        enqueueWaMessage(chatId, activeChat, message)
        await ctx.reply(`Sent to WhatsApp: ${message}`)
      } catch (err) {
        await ctx.reply(`Failed to send: ${String(err)}`)
      }
      return
    }

    await ctx.reply(
      'WhatsApp commands:\n' +
      '/wa list — list recent chats\n' +
      '/wa read <chat_id> — read messages\n' +
      '/wa send <message> — reply to active chat'
    )
  })

  // ─── Message handlers ─────────────────────────────────────────────────────

  bot.on('message:text', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    await handleMessage(ctx, ctx.message.text)
  })

  bot.on('message:voice', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    const caps = voiceCapabilities()
    if (!caps.stt) {
      await ctx.reply('Voice transcription is not configured (GROQ_API_KEY missing).')
      return
    }
    try {
      await ctx.replyWithChatAction('typing')
      const fileId = ctx.message.voice.file_id
      const localPath = await downloadMedia(fileId, 'voice.oga')
      const transcript = await transcribeAudio(localPath)
      fs.unlinkSync(localPath)
      await handleMessage(ctx, `[Voice transcribed]: ${transcript}`, true)
    } catch (err) {
      logger.error({ err }, 'Voice handler failed')
      await ctx.reply(`Voice processing failed: ${String(err)}`)
    }
  })

  bot.on('message:photo', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    try {
      await ctx.replyWithChatAction('upload_photo')
      const photo = ctx.message.photo[ctx.message.photo.length - 1]
      const localPath = await downloadMedia(photo.file_id, 'photo.jpg')
      const msg = buildPhotoMessage(localPath, ctx.message.caption)
      await handleMessage(ctx, msg)
    } catch (err) {
      logger.error({ err }, 'Photo handler failed')
      await ctx.reply(`Photo processing failed: ${String(err)}`)
    }
  })

  bot.on('message:document', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    try {
      await ctx.replyWithChatAction('upload_document')
      const doc = ctx.message.document
      const localPath = await downloadMedia(doc.file_id, doc.file_name ?? 'document')
      const msg = buildDocumentMessage(localPath, doc.file_name ?? 'document', ctx.message.caption)
      await handleMessage(ctx, msg)
    } catch (err) {
      logger.error({ err }, 'Document handler failed')
      await ctx.reply(`Document processing failed: ${String(err)}`)
    }
  })

  bot.on('message:video', async ctx => {
    if (!isAuthorised(ctx.chat.id)) return
    try {
      await ctx.replyWithChatAction('upload_video')
      const video = ctx.message.video
      const localPath = await downloadMedia(video.file_id, 'video.mp4')
      const msg = buildVideoMessage(localPath, ctx.message.caption)
      await handleMessage(ctx, msg)
    } catch (err) {
      logger.error({ err }, 'Video handler failed')
      await ctx.reply(`Video processing failed: ${String(err)}`)
    }
  })

  // Error handler
  bot.catch(err => {
    logger.error({ err }, 'Unhandled bot error')
  })

  return bot
}

export function formatForTelegram(text: string): string {
  const codeBlocks: string[] = []
  let result = text.replace(/```[\s\S]*?```/g, match => {
    const idx = codeBlocks.push(match) - 1
    return `\x00CODE${idx}\x00`
  })

  result = result.replace(/\x00CODE\d+\x00|[&<>]/g, m => {
    if (m.startsWith('\x00')) return m
    if (m === '&') return '&amp;'
    if (m === '<') return '&lt;'
    if (m === '>') return '&gt;'
    return m
  })

  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  result = result.replace(/__(.+?)__/g, '<b>$1</b>')
  result = result.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>')
  result = result.replace(/_([^_\n]+?)_/g, '<i>$1</i>')
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>')
  result = result.replace(/`([^`\n]+?)`/g, '<code>$1</code>')
  result = result.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>')
  result = result.replace(/- \[ \]/g, '☐')
  result = result.replace(/- \[x\]/gi, '☑')
  result = result.replace(/^---+$/gm, '')
  result = result.replace(/^\*\*\*+$/gm, '')
  result = result.replace(/<(?!\/?(b|i|code|pre|s|a|u)[\s>])[^>]+>/gi, '')

  result = result.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
    const block = codeBlocks[Number(idx)]
    const match = block.match(/^```(\w*)\n?([\s\S]*?)```$/)
    if (!match) return `<pre>${block.slice(3, -3)}</pre>`
    const lang = match[1]
    const code = match[2]
    return lang
      ? `<pre><code class="language-${lang}">${code}</code></pre>`
      : `<pre>${code}</pre>`
  })

  return result.trim()
}
