import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from './logger.js'
import { initDatabase } from './db.js'
import { createBot } from './bot.js'
import { runDecaySweep } from './memory.js'
import { cleanupOldUploads } from './media.js'
import { initScheduler, stopScheduler } from './scheduler.js'
import { initWhatsApp, stopWhatsApp } from './whatsapp.js'
import { TELEGRAM_BOT_TOKEN, STORE_DIR } from './config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PID_FILE = path.join(STORE_DIR, 'claudeclaw.pid')

// ─── PID lock ───────────────────────────────────────────────────────────────

function acquireLock(): void {
  fs.mkdirSync(STORE_DIR, { recursive: true })

  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (existingPid && !isNaN(existingPid)) {
      try {
        process.kill(existingPid, 0)
        // Process is alive — kill it
        logger.info({ pid: existingPid }, 'Killing existing ClaudeClaw process')
        process.kill(existingPid, 'SIGTERM')
      } catch {
        // Stale PID — process already dead
      }
    }
  }

  fs.writeFileSync(PID_FILE, String(process.pid))
}

function releaseLock(): void {
  try {
    fs.unlinkSync(PID_FILE)
  } catch {
    // Ignore
  }
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

function setupShutdown(onShutdown: () => void): void {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down ClaudeClaw...')
    onShutdown()
    releaseLock()
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function showBanner(): void {
  const bannerPath = path.join(__dirname, '..', 'banner.txt')
  if (fs.existsSync(bannerPath)) {
    console.log(fs.readFileSync(bannerPath, 'utf8'))
  } else {
    console.log(`
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
    `)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  showBanner()

  if (!TELEGRAM_BOT_TOKEN) {
    console.error(
      '\nError: TELEGRAM_BOT_TOKEN is not set.\n' +
      'Run: npm run setup\n'
    )
    process.exit(1)
  }

  acquireLock()
  logger.info('Starting ClaudeClaw...')

  // Initialize database
  initDatabase()
  logger.info('Database initialized')

  // Memory decay sweep (daily)
  runDecaySweep()
  setInterval(runDecaySweep, 24 * 60 * 60 * 1000)

  // Clean up old uploads
  cleanupOldUploads()

  // Create and configure bot
  const bot = createBot()

  // Create sender function for scheduler
  const sendMessage = async (chatId: string, text: string): Promise<void> => {
    await bot.api.sendMessage(chatId, text)
  }

  // Initialize scheduler
  initScheduler(sendMessage)

  // Initialize WhatsApp bridge
  initWhatsApp(async (waChatId, contact, body) => {
    // Forward incoming WhatsApp messages to the primary Telegram chat
    const { ALLOWED_CHAT_ID } = await import('./config.js')
    if (ALLOWED_CHAT_ID) {
      const preview = body.length > 100 ? body.slice(0, 100) + '...' : body
      await bot.api.sendMessage(
        ALLOWED_CHAT_ID,
        `WhatsApp from ${contact}:\n${preview}`
      )
    }
  })

  // Graceful shutdown
  setupShutdown(() => {
    stopScheduler()
    stopWhatsApp()
    bot.stop()
  })

  // Start the bot
  logger.info('ClaudeClaw running — waiting for messages...')
  await bot.start({
    onStart: ({ username }) => {
      logger.info({ username }, `Bot @${username} started`)
    },
  })
}

main().catch(err => {
  logger.error({ err }, 'Fatal error in main')
  process.exit(1)
})
