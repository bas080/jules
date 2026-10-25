import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { apiRequest, isRateLimitError, getNextRateLimitInterval, stepDownPollInterval, handlePollingError } from '../../src/common.js'

describe('rateLimit Unit Tests', () => {
  let stdoutLogs = []
  let stderrLogs = []
  let originalConsoleLog = console.log
  let originalConsoleError = console.error
  let originalDebug = process.env.DEBUG
  let originalPollInterval = process.env.JULES_POLL_INTERVAL
  let originalFetch = global.fetch

  beforeEach(() => {
    stdoutLogs = []
    stderrLogs = []
    originalConsoleLog = console.log
    originalConsoleError = console.error
    originalDebug = process.env.DEBUG
    originalPollInterval = process.env.JULES_POLL_INTERVAL
    originalFetch = global.fetch
    delete process.env.DEBUG
    delete process.env.JULES_POLL_INTERVAL

    console.log = (...args) => {
      stdoutLogs.push(args.join(' '))
    }
    console.error = (...args) => {
      stderrLogs.push(args.join(' '))
    }
  })

  afterEach(() => {
    console.log = originalConsoleLog
    console.error = originalConsoleError
    global.fetch = originalFetch
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug
    } else {
      delete process.env.DEBUG
    }
    if (originalPollInterval !== undefined) {
      process.env.JULES_POLL_INTERVAL = originalPollInterval
    } else {
      delete process.env.JULES_POLL_INTERVAL
    }
  })

  test('isRateLimitError correctly identifies 429 status and message errors', () => {
    assert.strictEqual(isRateLimitError({ status: 429 }), true)
    assert.strictEqual(isRateLimitError(new Error('API Error (429): Rate limit exceeded')), true)
    assert.strictEqual(isRateLimitError({ status: 500 }), false)
    assert.strictEqual(isRateLimitError(new Error('Internal error')), false)
    assert.strictEqual(isRateLimitError(null), false)
  })

  test('getNextRateLimitInterval doubles interval up to maxInterval', () => {
    assert.strictEqual(getNextRateLimitInterval(3000, 3000, 30000), 6000)
    assert.strictEqual(getNextRateLimitInterval(6000, 3000, 30000), 12000)
    assert.strictEqual(getNextRateLimitInterval(20000, 3000, 30000), 30000)

    process.env.JULES_POLL_INTERVAL = '50'
    assert.strictEqual(getNextRateLimitInterval(3000, 3000, 30000), 50)
  })

  test('stepDownPollInterval gradually decreases interval back to baseInterval', () => {
    assert.strictEqual(stepDownPollInterval(6000, 3000), 4000)
    assert.strictEqual(stepDownPollInterval(4000, 3000), 3000)
    assert.strictEqual(stepDownPollInterval(3000, 3000), 3000)
  })

  test('handlePollingError prints 429 rate limit warning to stdout (console.log)', () => {
    const err = { status: 429, message: 'Too many requests' }
    handlePollingError(err, 'test loop')

    assert.strictEqual(stdoutLogs.length, 1)
    assert.strictEqual(stderrLogs.length, 0)
    assert.match(stdoutLogs[0], /Rate limit reached \(HTTP 429\)\. Retrying with backoff\.\.\./)
  })

  test('handlePollingError in DEBUG mode prints rate limit error to stdout', () => {
    process.env.DEBUG = '1'
    const err = { status: 429, message: 'Too many requests' }
    handlePollingError(err, 'test loop')

    assert.strictEqual(stdoutLogs.length, 1)
    assert.strictEqual(stderrLogs.length, 0)
    assert.match(stdoutLogs[0], /Error in test loop: Too many requests/)
  })

  test('handlePollingError for non-429 error prints to stderr', () => {
    const err = new Error('Database connection failed')
    handlePollingError(err, 'background loop')

    assert.strictEqual(stdoutLogs.length, 0)
    assert.strictEqual(stderrLogs.length, 1)
    assert.match(stderrLogs[0], /Error in background loop: Database connection failed/)
  })

  test('apiRequest retries HTTP 429 internally and logs warning to stdout', async () => {
    process.env.JULES_POLL_INTERVAL = '1'
    let attempts = 0
    global.fetch = async () => {
      attempts++
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded'
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      }
    }

    const data = await apiRequest('test-endpoint', 'GET', null, true)
    assert.deepStrictEqual(data, { success: true })
    assert.strictEqual(attempts, 2)
    assert.strictEqual(stdoutLogs.length, 1)
    assert.match(stdoutLogs[0], /Rate limit reached \(HTTP 429\)\. Retrying with backoff\.\.\./)
  })
})
