import { describe, it, expect } from 'vitest'
import { formatForTelegram } from '../bot.js'

describe('formatForTelegram', () => {
  it('converts bold markdown to HTML', () => {
    const result = formatForTelegram('**bold text**')
    expect(result).toContain('<b>bold text</b>')
  })

  it('converts italic markdown to HTML', () => {
    const result = formatForTelegram('*italic text*')
    expect(result).toContain('<i>italic text</i>')
  })

  it('converts inline code to HTML', () => {
    const result = formatForTelegram('use `npm install` to install')
    expect(result).toContain('<code>npm install</code>')
  })

  it('converts markdown links to HTML anchors', () => {
    const result = formatForTelegram('[click here](https://example.com)')
    expect(result).toContain('<a href="https://example.com">click here</a>')
  })

  it('converts strikethrough to HTML', () => {
    const result = formatForTelegram('~~deleted~~')
    expect(result).toContain('<s>deleted</s>')
  })

  it('converts headings to bold', () => {
    const result = formatForTelegram('# My Heading')
    expect(result).toContain('<b>My Heading</b>')
  })

  it('preserves code block contents unchanged', () => {
    const result = formatForTelegram('```\nconst x = 1 > 0;\n```')
    // Should not double-escape the > inside code blocks
    expect(result).toContain('const x = 1 > 0;')
    expect(result).toContain('<pre>')
  })

  it('escapes & in regular text', () => {
    const result = formatForTelegram('cats & dogs')
    expect(result).toContain('cats &amp; dogs')
  })

  it('converts unchecked checkbox', () => {
    const result = formatForTelegram('- [ ] todo item')
    expect(result).toContain('☐')
  })

  it('converts checked checkbox', () => {
    const result = formatForTelegram('- [x] done item')
    expect(result).toContain('☑')
  })

  it('handles empty string', () => {
    const result = formatForTelegram('')
    expect(result).toBe('')
  })

  it('handles plain text without any markdown', () => {
    const result = formatForTelegram('just plain text here')
    expect(result).toBe('just plain text here')
  })
})
