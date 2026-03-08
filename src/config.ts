import { fileURLToPath } from 'url'
import path from 'path'
import { readEnvFile } from './env.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const PROJECT_ROOT = path.resolve(__dirname, '..')
export const STORE_DIR = path.join(PROJECT_ROOT, 'store')

const env = readEnvFile()

// Telegram
export const TELEGRAM_BOT_TOKEN = env['TELEGRAM_BOT_TOKEN'] || process.env.TELEGRAM_BOT_TOKEN || ''
export const ALLOWED_CHAT_ID = env['ALLOWED_CHAT_ID'] || process.env.ALLOWED_CHAT_ID || ''

// Voice STT - Groq
export const GROQ_API_KEY = env['GROQ_API_KEY'] || process.env.GROQ_API_KEY || ''

// Voice TTS - ElevenLabs
export const ELEVENLABS_API_KEY = env['ELEVENLABS_API_KEY'] || process.env.ELEVENLABS_API_KEY || ''
export const ELEVENLABS_VOICE_ID = env['ELEVENLABS_VOICE_ID'] || process.env.ELEVENLABS_VOICE_ID || ''

// Video analysis - Gemini
export const GOOGLE_API_KEY = env['GOOGLE_API_KEY'] || process.env.GOOGLE_API_KEY || ''

// Multi-user (comma-separated list of allowed chat IDs)
export const ALLOWED_CHAT_IDS = env['ALLOWED_CHAT_IDS'] || process.env.ALLOWED_CHAT_IDS || ''

// WhatsApp
export const WHATSAPP_ENABLED = (env['WHATSAPP_ENABLED'] || process.env.WHATSAPP_ENABLED || 'false') === 'true'

// Limits
export const MAX_MESSAGE_LENGTH = 4096
export const TYPING_REFRESH_MS = 4000
