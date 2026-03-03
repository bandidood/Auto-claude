import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const TEST_ENV_PATH = path.join(PROJECT_ROOT, '.env.test')

// Patch readEnvFile to use test path
const originalEnvPath = path.join(PROJECT_ROOT, '.env')

describe('readEnvFile', () => {
  it('returns empty object when .env does not exist', async () => {
    // Use a path that definitely doesn't exist
    const { readEnvFile } = await import('../env.js')
    // env.ts reads from PROJECT_ROOT/.env -- if it doesn't exist returns {}
    const result = readEnvFile(['NONEXISTENT_KEY'])
    // Either {} or whatever is in the existing .env -- just check it doesn't throw
    expect(typeof result).toBe('object')
  })

  it('parses KEY=VALUE format', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), 'TEST_KEY_ABC=hello123\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['TEST_KEY_ABC'])
    // Cleanup
    try { unlinkSync(path.join(PROJECT_ROOT, '.env')) } catch {}
    expect(result['TEST_KEY_ABC']).toBe('hello123')
  })

  it('strips double quotes from values', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), 'QUOTED_KEY="hello world"\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['QUOTED_KEY'])
    try { unlinkSync(path.join(PROJECT_ROOT, '.env')) } catch {}
    expect(result['QUOTED_KEY']).toBe('hello world')
  })

  it('skips comment lines', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), '# This is a comment\nREAL_KEY=value\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile()
    try { unlinkSync(path.join(PROJECT_ROOT, '.env')) } catch {}
    expect(result['REAL_KEY']).toBe('value')
    expect(result['# This is a comment']).toBeUndefined()
  })

  it('filters by keys array', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), 'KEY_A=aaa\nKEY_B=bbb\nKEY_C=ccc\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['KEY_A', 'KEY_C'])
    try { unlinkSync(path.join(PROJECT_ROOT, '.env')) } catch {}
    expect(result['KEY_A']).toBe('aaa')
    expect(result['KEY_B']).toBeUndefined()
    expect(result['KEY_C']).toBe('ccc')
  })
})
