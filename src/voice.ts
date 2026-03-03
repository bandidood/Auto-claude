import https from 'https'
import fs from 'fs'
import path from 'path'
import { readEnvFile } from './env.js'
import { logger } from './logger.js'

function getGroqKey(): string {
  return readEnvFile(['GROQ_API_KEY'])['GROQ_API_KEY'] ?? ''
}

function getElevenLabsKey(): string {
  return readEnvFile(['ELEVENLABS_API_KEY'])['ELEVENLABS_API_KEY'] ?? ''
}

function getElevenLabsVoiceId(): string {
  return readEnvFile(['ELEVENLABS_VOICE_ID'])['ELEVENLABS_VOICE_ID'] ?? ''
}

export function voiceCapabilities(): { stt: boolean; tts: boolean } {
  return {
    stt: Boolean(getGroqKey()),
    tts: Boolean(getElevenLabsKey() && getElevenLabsVoiceId()),
  }
}

// ─── STT — Groq Whisper ────────────────────────────────────────────────────

export async function transcribeAudio(filePath: string): Promise<string> {
  const apiKey = getGroqKey()
  if (!apiKey) throw new Error('GROQ_API_KEY not set')

  // Groq won't accept .oga — rename to .ogg (same format, different extension)
  let actualPath = filePath
  if (filePath.endsWith('.oga')) {
    actualPath = filePath.replace(/\.oga$/, '.ogg')
    fs.renameSync(filePath, actualPath)
  }

  const fileBuffer = fs.readFileSync(actualPath)
  const filename = path.basename(actualPath)

  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`

  const bodyParts: Buffer[] = []

  const modelPart = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`
  )
  const filePart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/ogg\r\n\r\n`
    ),
    fileBuffer,
    Buffer.from('\r\n'),
  ])
  const endPart = Buffer.from(`--${boundary}--\r\n`)

  bodyParts.push(modelPart, filePart, endPart)
  const body = Buffer.concat(bodyParts)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString())
            if (json.text) {
              resolve(json.text as string)
            } else {
              reject(new Error(`Groq transcription failed: ${JSON.stringify(json)}`))
            }
          } catch (err) {
            reject(err)
          }
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─── TTS — ElevenLabs ─────────────────────────────────────────────────────

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = getElevenLabsKey()
  const voiceId = getElevenLabsVoiceId()
  if (!apiKey || !voiceId) throw new Error('ElevenLabs credentials not set')

  const bodyJson = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${voiceId}`,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyJson),
          Accept: 'audio/mpeg',
        },
      },
      res => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            reject(
              new Error(
                `ElevenLabs TTS failed (${res.statusCode}): ${Buffer.concat(chunks).toString()}`
              )
            )
          })
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.on('error', reject)
    req.write(bodyJson)
    req.end()
  })
}
