import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from './logger.js'
import { readEnvFile } from './env.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const UPLOADS_DIR = path.join(__dirname, '..', 'workspace', 'uploads')

function getBotToken(): string {
  return readEnvFile(['TELEGRAM_BOT_TOKEN'])['TELEGRAM_BOT_TOKEN'] ?? ''
}

function httpsGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-')
}

export async function downloadMedia(
  fileId: string,
  originalFilename?: string
): Promise<string> {
  const token = getBotToken()
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set')

  // Get file path from Telegram
  const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  const fileInfoBuffer = await httpsGet(getFileUrl)
  const fileInfo = JSON.parse(fileInfoBuffer.toString()) as {
    ok: boolean
    result?: { file_path: string }
  }

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error(`Failed to get file path: ${JSON.stringify(fileInfo)}`)
  }

  const remotePath = fileInfo.result.file_path
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${remotePath}`

  const fileData = await httpsGet(downloadUrl)

  // Build local filename
  const ext = path.extname(remotePath) || (originalFilename ? path.extname(originalFilename) : '')
  const baseName = originalFilename
    ? sanitizeFilename(path.basename(originalFilename, ext))
    : 'media'
  const localFilename = `${Date.now()}_${sanitizeFilename(baseName)}${ext}`
  const localPath = path.join(UPLOADS_DIR, localFilename)

  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  fs.writeFileSync(localPath, fileData)

  logger.debug({ localPath, size: fileData.length }, 'Media downloaded')
  return localPath
}

export function buildPhotoMessage(localPath: string, caption?: string): string {
  const parts = [
    `I've received a photo. The file is saved at: ${localPath}`,
    'Please analyze this image and describe what you see.',
  ]
  if (caption) parts.push(`Caption: ${caption}`)
  return parts.join('\n')
}

export function buildDocumentMessage(
  localPath: string,
  filename: string,
  caption?: string
): string {
  const parts = [
    `I've received a document: "${filename}"`,
    `File path: ${localPath}`,
    'Please read and analyze this file.',
  ]
  if (caption) parts.push(`Note: ${caption}`)
  return parts.join('\n')
}

export function buildVideoMessage(localPath: string, caption?: string): string {
  const googleApiKey = readEnvFile(['GOOGLE_API_KEY'])['GOOGLE_API_KEY'] ?? ''
  const parts = [
    `I've received a video file saved at: ${localPath}`,
    `Please analyze this video using the Gemini API (GOOGLE_API_KEY is available in .env as: ${googleApiKey ? '[set]' : '[not set]'}).`,
    'Describe what happens in the video.',
  ]
  if (caption) parts.push(`Caption: ${caption}`)
  return parts.join('\n')
}

export function cleanupOldUploads(maxAgeMs = 24 * 60 * 60 * 1000): void {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return
    const now = Date.now()
    const files = fs.readdirSync(UPLOADS_DIR)
    for (const file of files) {
      const filePath = path.join(UPLOADS_DIR, file)
      const stat = fs.statSync(filePath)
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath)
        logger.debug({ file }, 'Cleaned up old upload')
      }
    }
  } catch (err) {
    logger.warn({ err }, 'cleanupOldUploads failed')
  }
}
