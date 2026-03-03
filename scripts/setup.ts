#!/usr/bin/env tsx
import readline from 'readline'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// ─── ANSI colors ─────────────────────────────────────────────────────────────

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  reset: (s: string) => `\x1b[0m${s}\x1b[0m`,
}

const ok = (msg: string) => console.log(`  ${c.green('✓')} ${msg}`)
const warn = (msg: string) => console.log(`  ${c.yellow('⚠')} ${msg}`)
const fail = (msg: string) => console.log(`  ${c.red('✗')} ${msg}`)
const info = (msg: string) => console.log(`  ${c.cyan('→')} ${msg}`)

// ─── rl helper ───────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (question: string): Promise<string> =>
  new Promise(resolve => rl.question(question, resolve))

// ─── Banner ──────────────────────────────────────────────────────────────────

function showBanner(): void {
  console.log(c.cyan(`
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
  `))
  console.log(c.bold('  ClaudeClaw Setup Wizard\n'))
}

// ─── Requirement checks ───────────────────────────────────────────────────────

function checkRequirements(): boolean {
  console.log(c.bold('\nChecking requirements...\n'))
  let allGood = true

  // Node version
  const nodeVersion = process.version
  const major = parseInt(nodeVersion.slice(1))
  if (major >= 20) {
    ok(`Node.js ${nodeVersion}`)
  } else {
    fail(`Node.js ${nodeVersion} — requires >=20`)
    allGood = false
  }

  // Claude CLI
  try {
    const result = spawnSync('claude', ['--version'], { encoding: 'utf8' })
    if (result.status === 0) {
      ok(`Claude CLI: ${result.stdout.trim()}`)
    } else {
      fail('Claude CLI not found — install with: npm install -g @anthropic-ai/claude-code')
      allGood = false
    }
  } catch {
    fail('Claude CLI not found')
    allGood = false
  }

  return allGood
}

// ─── Build ───────────────────────────────────────────────────────────────────

async function buildProject(): Promise<boolean> {
  console.log(c.bold('\nBuilding project...\n'))
  try {
    info('Running npm install...')
    execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' })
    ok('Dependencies installed')

    info('Running npm run build...')
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'inherit' })
    ok('TypeScript compiled')
    return true
  } catch (err) {
    fail(`Build failed: ${String(err)}`)
    return false
  }
}

// ─── Config collection ────────────────────────────────────────────────────────

interface Config {
  TELEGRAM_BOT_TOKEN: string
  ALLOWED_CHAT_ID: string
  GROQ_API_KEY: string
  ELEVENLABS_API_KEY: string
  ELEVENLABS_VOICE_ID: string
  GOOGLE_API_KEY: string
  LOG_LEVEL: string
}

async function collectConfig(): Promise<Config> {
  console.log(c.bold('\nConfiguration\n'))

  console.log('To get your Telegram bot token:')
  info('1. Open Telegram and search for @BotFather')
  info('2. Send /newbot')
  info('3. Follow the prompts to name your bot')
  info('4. Copy the token it gives you\n')

  const botToken = await ask('  Telegram bot token: ')

  console.log('\nGroq API key (for voice transcription):')
  info('Free at https://console.groq.com — create account, go to API Keys\n')
  const groqKey = await ask('  Groq API key (leave empty to skip): ')

  let elevenKey = ''
  let elevenVoiceId = ''
  if (groqKey) {
    console.log('\nElevenLabs API key (for voice replies):')
    info('Free tier at https://elevenlabs.io — go to Profile > API Key\n')
    elevenKey = await ask('  ElevenLabs API key (leave empty to skip): ')
    if (elevenKey) {
      elevenVoiceId = await ask('  ElevenLabs Voice ID (find in Voices page): ')
    }
  }

  console.log('\nGoogle API key (for video analysis):')
  info('Free at https://aistudio.google.com — click Get API Key\n')
  const googleKey = await ask('  Google API key (leave empty to skip): ')

  return {
    TELEGRAM_BOT_TOKEN: botToken.trim(),
    ALLOWED_CHAT_ID: '',
    GROQ_API_KEY: groqKey.trim(),
    ELEVENLABS_API_KEY: elevenKey.trim(),
    ELEVENLABS_VOICE_ID: elevenVoiceId.trim(),
    GOOGLE_API_KEY: googleKey.trim(),
    LOG_LEVEL: 'info',
  }
}

// ─── Write .env ───────────────────────────────────────────────────────────────

function writeEnv(config: Config): void {
  const lines = [
    '# ClaudeClaw configuration',
    '# Generated by setup wizard',
    '',
    '# Telegram',
    `TELEGRAM_BOT_TOKEN=${config.TELEGRAM_BOT_TOKEN}`,
    `ALLOWED_CHAT_ID=${config.ALLOWED_CHAT_ID}`,
    '',
    '# Voice STT — Groq',
    `GROQ_API_KEY=${config.GROQ_API_KEY}`,
    '',
    '# Voice TTS — ElevenLabs',
    `ELEVENLABS_API_KEY=${config.ELEVENLABS_API_KEY}`,
    `ELEVENLABS_VOICE_ID=${config.ELEVENLABS_VOICE_ID}`,
    '',
    '# Video — Google Gemini',
    `GOOGLE_API_KEY=${config.GOOGLE_API_KEY}`,
    '',
    '# Logging',
    `LOG_LEVEL=${config.LOG_LEVEL}`,
  ]
  fs.writeFileSync(path.join(PROJECT_ROOT, '.env'), lines.join('\n') + '\n')
  ok('.env written')
}

// ─── Open CLAUDE.md ───────────────────────────────────────────────────────────

async function openClaudeMd(): Promise<void> {
  console.log(c.bold('\nPersonalize your assistant\n'))
  info('CLAUDE.md is your assistant\'s system prompt.')
  info('Fill in your name, your assistant\'s name, and what you do.')
  info('The more context you give, the more useful it becomes.\n')

  const answer = await ask('  Open CLAUDE.md in your editor now? (y/n): ')
  if (answer.toLowerCase() === 'y') {
    const editor = process.env.EDITOR || (os.platform() === 'win32' ? 'notepad' : 'nano')
    const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md')
    try {
      spawnSync(editor, [claudeMdPath], { stdio: 'inherit' })
    } catch {
      warn(`Could not open editor. Edit CLAUDE.md manually at: ${claudeMdPath}`)
    }
  } else {
    warn('Remember to edit CLAUDE.md before using the bot.')
  }
}

// ─── Service installation ─────────────────────────────────────────────────────

async function installService(): Promise<void> {
  console.log(c.bold('\nBackground service installation\n'))

  const platform = os.platform()

  if (platform === 'darwin') {
    // macOS launchd
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claudeclaw.app.plist')
    const nodePath = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim()
    const logPath = '/tmp/claudeclaw.log'

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeclaw.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${path.join(PROJECT_ROOT, 'dist', 'index.js')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>`

    fs.mkdirSync(path.dirname(plistPath), { recursive: true })
    fs.writeFileSync(plistPath, plist)

    try {
      spawnSync('launchctl', ['unload', plistPath], { encoding: 'utf8' })
      const result = spawnSync('launchctl', ['load', plistPath], { encoding: 'utf8' })
      if (result.status === 0) {
        ok('launchd service installed and loaded')
        info(`Logs: tail -f ${logPath}`)
        info('To stop: launchctl unload ~/Library/LaunchAgents/com.claudeclaw.app.plist')
      } else {
        warn('launchctl load failed — try manually: launchctl load ' + plistPath)
      }
    } catch {
      warn('Could not load launchd service — install manually')
    }

  } else if (platform === 'linux') {
    // systemd user service
    const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
    const servicePath = path.join(serviceDir, 'claudeclaw.service')
    const nodePath = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim()

    const unit = `[Unit]
Description=ClaudeClaw personal AI assistant
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${path.join(PROJECT_ROOT, 'dist', 'index.js')}
WorkingDirectory=${PROJECT_ROOT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`

    fs.mkdirSync(serviceDir, { recursive: true })
    fs.writeFileSync(servicePath, unit)

    try {
      spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' })
      spawnSync('systemctl', ['--user', 'enable', 'claudeclaw'], { encoding: 'utf8' })
      const result = spawnSync('systemctl', ['--user', 'start', 'claudeclaw'], { encoding: 'utf8' })
      if (result.status === 0) {
        ok('systemd user service installed and started')
        info('Logs: journalctl --user -u claudeclaw -f')
        info('To stop: systemctl --user stop claudeclaw')
      } else {
        warn('systemd service could not start — check: systemctl --user status claudeclaw')
      }
    } catch {
      warn('Could not configure systemd service — install manually')
    }

  } else {
    // Windows — PM2 instructions
    console.log(c.yellow('\n  Windows detected. Manual setup required:\n'))
    info('1. Install PM2: npm install -g pm2')
    info(`2. Start: pm2 start "${path.join(PROJECT_ROOT, 'dist', 'index.js')}" --name claudeclaw`)
    info('3. Save: pm2 save')
    info('4. Auto-start: pm2 startup')
  }
}

// ─── Get chat ID ──────────────────────────────────────────────────────────────

async function getChatId(botToken: string): Promise<string> {
  console.log(c.bold('\nGet your Telegram chat ID\n'))
  info(`Start your bot: open Telegram and search for your bot`)
  info('Send it the message: /chatid\n')

  const chatId = await ask('  Paste your chat ID here: ')
  return chatId.trim()
}

// ─── Update .env ──────────────────────────────────────────────────────────────

function updateEnvChatId(chatId: string): void {
  const envPath = path.join(PROJECT_ROOT, '.env')
  const content = fs.readFileSync(envPath, 'utf8')
  const updated = content.replace(/^ALLOWED_CHAT_ID=.*$/m, `ALLOWED_CHAT_ID=${chatId}`)
  fs.writeFileSync(envPath, updated)
  ok(`Chat ID saved: ${chatId}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  showBanner()

  const reqs = checkRequirements()
  if (!reqs) {
    console.log(c.red('\nPlease fix the requirements above before continuing.\n'))
    rl.close()
    process.exit(1)
  }

  const built = await buildProject()
  if (!built) {
    console.log(c.red('\nBuild failed. Fix the errors above and try again.\n'))
    rl.close()
    process.exit(1)
  }

  const config = await collectConfig()
  writeEnv(config)

  await openClaudeMd()

  const installAnswer = await ask('\n  Install as background service? (y/n): ')
  if (installAnswer.toLowerCase() === 'y') {
    await installService()
  } else {
    info('Skipped service installation. Run manually with: npm run start')
  }

  console.log(c.bold('\n\nAlmost done!\n'))
  info('Now we need your Telegram chat ID.')
  info('Start the bot temporarily to get it...\n')

  const startAnswer = await ask('  Ready to start the bot briefly to get your chat ID? (y/n): ')
  if (startAnswer.toLowerCase() === 'y') {
    const chatId = await getChatId(config.TELEGRAM_BOT_TOKEN)
    if (chatId) {
      updateEnvChatId(chatId)
    }
  } else {
    warn('You can set ALLOWED_CHAT_ID in .env manually later.')
  }

  console.log(c.green(c.bold('\n\nSetup complete!\n')))
  info('Start the bot: npm run start')
  info('View logs: npm run status')
  info('Dev mode: npm run dev')
  console.log('')
  info('Commands in Telegram:')
  info('  /start — show available commands')
  info('  /newchat — clear session')
  info('  /voice — toggle voice replies')
  info('  /schedule — manage scheduled tasks')
  info('  /wa — WhatsApp bridge')
  console.log('')

  rl.close()
}

main().catch(err => {
  console.error(c.red('\nSetup failed:'), err)
  rl.close()
  process.exit(1)
})
