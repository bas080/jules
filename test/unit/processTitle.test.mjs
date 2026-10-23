import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { runCli } from '../../src/cli.js'

describe('process.title Unit Tests', () => {
  let originalTitle

  beforeEach(() => {
    originalTitle = process.title
  })

  afterEach(() => {
    process.title = originalTitle
  })

  test('runCli sets process.title to jules', async () => {
    await runCli(['node', 'jules', '--help'])
    assert.strictEqual(process.title, 'jules')
  })
})
