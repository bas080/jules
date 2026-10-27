import { test, describe } from 'node:test'
import assert from 'node:assert'
import { getPrInfo } from '../../src/common.js'

describe('getPrInfo Unit Tests', () => {
  test('returns default status when no pull request present', () => {
    const info = getPrInfo({}, [])
    assert.strictEqual(info.url, null)
    assert.strictEqual(info.status, 'None generated yet')
    assert.strictEqual(info.isMerged, false)
  })

  test('extracts open PR status from session outputs', () => {
    const sessionInfo = {
      outputs: [
        {
          pullRequest: {
            url: 'https://github.com/owner/repo/pull/10',
            state: 'OPEN',
            merged: false
          }
        }
      ]
    }

    const info = getPrInfo(sessionInfo, [])
    assert.strictEqual(info.url, 'https://github.com/owner/repo/pull/10')
    assert.strictEqual(info.isMerged, false)
    assert.match(info.status, /Open \(Not merged\)/)
    assert.match(info.status, /https:\/\/github.com\/owner\/repo\/pull\/10/)
  })

  test('extracts merged PR status from session outputs', () => {
    const sessionInfo = {
      outputs: [
        {
          pullRequest: {
            url: 'https://github.com/owner/repo/pull/42',
            state: 'MERGED',
            merged: true
          }
        }
      ]
    }

    const info = getPrInfo(sessionInfo, [])
    assert.strictEqual(info.url, 'https://github.com/owner/repo/pull/42')
    assert.strictEqual(info.isMerged, true)
    assert.match(info.status, /Merged ✔/)
  })

  test('extracts PR status from activity artifacts when outputs empty', () => {
    const activities = [
      {
        artifacts: [
          {
            pullRequest: {
              url: 'https://github.com/owner/repo/pull/99',
              state: 'MERGED'
            }
          }
        ]
      }
    ]

    const info = getPrInfo({}, activities)
    assert.strictEqual(info.url, 'https://github.com/owner/repo/pull/99')
    assert.strictEqual(info.isMerged, true)
    assert.match(info.status, /Merged ✔/)
  })
})
