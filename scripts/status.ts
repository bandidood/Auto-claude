#!/usr/bin/env tsx
import { spawnSync } from 'child_process'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// Read .env directly without polluting process.env
function readEnv(): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (!fs.existsSync(envPath)) return {}
  const result: Record<string, string> = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    result[trimmed.slice(0, eqIdx).trim()] = val
  }
  return result
}

const env = readEnv()

const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
const warn = (msg: string) => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`)
const fail = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`)

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString()))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function main(): Promise<void> {
  console.log('\x1b[1m\nClaudeClaw Status\n\x1b[0m')

  // Node version
  const major = parseInt(process.version.slice(1))
  if (major >= 20) {
    ok(`Node.js ${process.version}`)
  } else {
    fail(`Node.js ${process.version} — requires >=20`)
  }

  // Claude CLI
  const claudeResult = spawnSync('claude', ['--version'], { encoding: 'utf8' })
  if (claudeResult.status === 0) {
    ok(`Claude CLI: ${claudeResult.stdout.trim()}`)
  } else {
    fail('Claude CLI not found')
  }

  // .env exists
  if (fs.existsSync(path.join(PROJECT_ROOT, '.env'))) {
    ok('.env file exists')
  } else {
    fail('.env not found — run npm run setup')
  }

  // dist/ exists
  if (fs.existsSync(path.join(PROJECT_ROOT, 'dist', 'index.js'))) {
    ok('Build exists (dist/index.js)')
  } else {
    fail('Build not found — run npm run build')
  }

  // Telegram token
  const token = env['TELEGRAM_BOT_TOKEN']
  if (token) {
    try {
      const res = await httpsGet(`https://api.telegram.org/bot${token}/getMe`)
      const data = JSON.parse(res)
      if (data.ok) {
        ok(`Telegram bot: @${data.result.username}`)
      } else {
        fail(`Telegram bot token invalid: ${data.description}`)
      }
    } catch (err) {
      fail(`Telegram API check failed: ${String(err)}`)
    }
  } else {
    fail('TELEGRAM_BOT_TOKEN not set')
  }

  // Chat ID
  if (env['ALLOWED_CHAT_ID']) {
    ok(`Allowed chat ID: ${env['ALLOWED_CHAT_ID']}`)
  } else {
    warn('ALLOWED_CHAT_ID not set — bot will accept all messages (first-run mode)')
  }

  // Groq
  if (env['GROQ_API_KEY']) {
    ok('Groq API key configured (STT enabled)')
  } else {
    warn('Groq API key not set (voice transcription disabled)')
  }

  // ElevenLabs
  if (env['ELEVENLABS_API_KEY'] && env['ELEVENLABS_VOICE_ID']) {
    ok('ElevenLabs configured (TTS enabled)')
  } else {
    warn('ElevenLabs not fully configured (voice replies disabled)')
  }

  // Google
  if (env['GOOGLE_API_KEY']) {
    ok('Google API key configured (video analysis enabled)')
  } else {
    warn('Google API key not set (video analysis disabled)')
  }

  // Service status
  const platform = os.platform()
  console.log('\n  Background service:')
  if (platform === 'darwin') {
    const result = spawnSync('launchctl', ['list', 'com.claudeclaw.app'], { encoding: 'utf8' })
    if (result.status === 0 && !result.stdout.includes('Could not find service')) {
      ok('launchd service: running')
    } else {
      warn('launchd service: not loaded')
    }
  } else if (platform === 'linux') {
    const result = spawnSync('systemctl', ['--user', 'is-active', 'claudeclaw'], { encoding: 'utf8' })
    if (result.stdout.trim() === 'active') {
      ok('systemd service: active')
    } else {
      warn(`systemd service: ${result.stdout.trim() || 'not found'}`)
    }
  } else {
    warn('Windows: check PM2 status with: pm2 status')
  }

  // Database
  const dbPath = path.join(PROJECT_ROOT, 'store', 'claudeclaw.db')
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath)
    ok(`Database: ${dbPath} (${Math.round(stat.size / 1024)}KB)`)
  } else {
    warn('Database not found (will be created on first run)')
  }

  console.log('')
}

main().catch(err => {
  console.error('Status check failed:', err)
  process.exit(1)
})
