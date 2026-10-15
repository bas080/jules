import { test, describe } from 'node:test'
import assert from 'node:assert'
import { renderMarkdown } from '../../src/common.js'

describe('renderMarkdown Unit Tests', () => {
  test('returns empty string for empty input', () => {
    assert.strictEqual(renderMarkdown(''), '')
    assert.strictEqual(renderMarkdown(null), '')
  })

  test('renders markdown text correctly with reflowText enabled', () => {
    const text = 'This is a long paragraph that tests whether renderMarkdown properly reflows text when FORCE_COLOR is active or color is supported.'
    process.env.FORCE_COLOR = '1'
    const rendered = renderMarkdown(text)
    assert.ok(rendered.length > 0)
    assert.ok(rendered.includes('This is a long paragraph'))
  })
})
