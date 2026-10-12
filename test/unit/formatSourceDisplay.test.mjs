import { test, describe } from 'node:test'
import assert from 'node:assert'
import { formatSourceDisplay } from '../../src/common.js'

describe('formatSourceDisplay Unit Tests', () => {
  test('returns none for null or undefined input', () => {
    assert.strictEqual(formatSourceDisplay(null), 'none')
    assert.strictEqual(formatSourceDisplay(undefined), 'none')
    assert.strictEqual(formatSourceDisplay(''), 'none')
  })

  test('formats string source names cleanly', () => {
    assert.strictEqual(formatSourceDisplay('sources/github/owner/repo'), 'owner/repo')
    assert.strictEqual(formatSourceDisplay('sources/custom-source'), 'custom-source')
    assert.strictEqual(formatSourceDisplay('owner/repo'), 'owner/repo')
  })

  test('extracts and formats source names from object structures', () => {
    assert.strictEqual(formatSourceDisplay({ source: 'sources/github/owner/repo' }), 'owner/repo')
    assert.strictEqual(formatSourceDisplay({ name: 'sources/github/owner/repo' }), 'owner/repo')
    assert.strictEqual(formatSourceDisplay({ sourceContext: 'sources/github/owner/repo' }), 'owner/repo')
    assert.strictEqual(formatSourceDisplay({ sourceContext: { source: 'sources/github/owner/repo' } }), 'owner/repo')
  })
})
