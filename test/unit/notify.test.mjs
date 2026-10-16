import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import notifier from 'node-notifier'
import { sendDesktopNotification } from '../../src/common.js'

describe('sendDesktopNotification Unit Tests', () => {
  let originalNotify
  let notifiedPayloads = []
  let originalJulesNotify

  beforeEach(() => {
    notifiedPayloads = []
    originalNotify = notifier.notify
    originalJulesNotify = process.env.JULES_NOTIFY
    delete process.env.JULES_NOTIFY

    Object.defineProperty(notifier, 'notify', {
      value: (opts) => {
        notifiedPayloads.push(opts)
      },
      configurable: true,
      writable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(notifier, 'notify', {
      value: originalNotify,
      configurable: true,
      writable: true
    })
    if (originalJulesNotify !== undefined) {
      process.env.JULES_NOTIFY = originalJulesNotify
    } else {
      delete process.env.JULES_NOTIFY
    }
  })

  test('sends notification when notify is enabled', () => {
    sendDesktopNotification('Test Title', 'Test Message', { notify: true })
    assert.strictEqual(notifiedPayloads.length, 1)
    assert.strictEqual(notifiedPayloads[0].title, 'Test Title')
    assert.strictEqual(notifiedPayloads[0].message, 'Test Message')
  })

  test('suppresses notification when options.notify is false', () => {
    sendDesktopNotification('Test Title', 'Test Message', { notify: false })
    assert.strictEqual(notifiedPayloads.length, 0)
  })

  test('suppresses notification when JULES_NOTIFY env var is "false"', () => {
    process.env.JULES_NOTIFY = 'false'
    sendDesktopNotification('Test Title', 'Test Message', { notify: true })
    assert.strictEqual(notifiedPayloads.length, 0)
  })

  test('suppresses notification when JULES_NOTIFY env var is "0"', () => {
    process.env.JULES_NOTIFY = '0'
    sendDesktopNotification('Test Title', 'Test Message', { notify: true })
    assert.strictEqual(notifiedPayloads.length, 0)
  })
})
