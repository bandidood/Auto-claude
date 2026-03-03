import { createRequire } from 'module'
import type { Client as ClientType, Message } from 'whatsapp-web.js'
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client, LocalAuth } = require('whatsapp-web.js') as { Client: typeof ClientType; LocalAuth: typeof import('whatsapp-web.js').LocalAuth }
import qrcode from 'qrcode-terminal'
import { saveWaMessage, getPendingWaMessages, markWaMessageSent } from './db.js'
import { logger } from './logger.js'
import { STORE_DIR } from './config.js'
import path from 'path'

export type OnIncomingMessage = (waChatId: string, contact: string, body: string) => Promise<void>

let waClient: ClientType | null = null
let outboxInterval: ReturnType<typeof setInterval> | null = null

export function initWhatsApp(onIncoming: OnIncomingMessage): void {
  const authPath = path.join(STORE_DIR, 'wa-session')

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  })

  waClient.on('qr', (qr: string) => {
    logger.info('WhatsApp QR code — scan with your phone:')
    qrcode.generate(qr, { small: true })
  })

  waClient.on('authenticated', () => {
    logger.info('WhatsApp authenticated')
  })

  waClient.on('ready', () => {
    logger.info('WhatsApp client ready')
    startOutboxPoller()
  })

  waClient.on('disconnected', (reason: string) => {
    logger.warn({ reason }, 'WhatsApp disconnected')
    stopOutboxPoller()
  })

  waClient.on('message', async (msg: Message) => {
    if (msg.fromMe) return
    try {
      const contact = msg.from
      const chat = await msg.getChat()
      const waChatId = chat.id._serialized
      saveWaMessage(waChatId, contact, 'in', msg.body, Math.floor(Date.now() / 1000))
      await onIncoming(waChatId, contact, msg.body)
    } catch (err) {
      logger.error({ err }, 'WhatsApp incoming message handler error')
    }
  })

  waClient.initialize().catch((err: unknown) => {
    logger.error({ err }, 'WhatsApp client initialization failed')
  })
}

function startOutboxPoller(): void {
  outboxInterval = setInterval(async () => {
    if (!waClient) return
    const pending = getPendingWaMessages()
    for (const item of pending) {
      try {
        await waClient.sendMessage(item.wa_contact, item.message)
        markWaMessageSent(item.id)
        saveWaMessage(item.wa_contact, item.wa_contact, 'out', item.message, Math.floor(Date.now() / 1000))
        logger.debug({ to: item.wa_contact }, 'WhatsApp message sent')
      } catch (err) {
        logger.error({ err, id: item.id }, 'Failed to send WhatsApp message')
      }
    }
  }, 3000)
}

function stopOutboxPoller(): void {
  if (outboxInterval) {
    clearInterval(outboxInterval)
    outboxInterval = null
  }
}

export async function getWaChats(): Promise<Array<{ id: string; name: string; lastMsg?: string }>> {
  if (!waClient) return []
  try {
    const chats = await waClient.getChats()
    return chats.slice(0, 20).map((c: import('whatsapp-web.js').Chat) => ({
      id: c.id._serialized,
      name: c.name || c.id.user,
      lastMsg: undefined,
    }))
  } catch (err) {
    logger.error({ err }, 'getWaChats failed')
    return []
  }
}

export async function getWaMessages(
  waChatId: string,
  limit = 10
): Promise<Array<{ from: string; body: string; timestamp: number }>> {
  if (!waClient) return []
  try {
    const chat = await waClient.getChatById(waChatId)
    const messages = await chat.fetchMessages({ limit })
    return messages.map((m: Message) => ({
      from: m.fromMe ? 'Me' : m.from,
      body: m.body,
      timestamp: m.timestamp,
    }))
  } catch (err) {
    logger.error({ err }, 'getWaMessages failed')
    return []
  }
}

export async function sendWaMessage(waChatId: string, text: string): Promise<void> {
  if (!waClient) throw new Error('WhatsApp client not initialized')
  await waClient.sendMessage(waChatId, text)
}

export function stopWhatsApp(): void {
  stopOutboxPoller()
  if (waClient) {
    waClient.destroy().catch(() => { })
    waClient = null
  }
}
