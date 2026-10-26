import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadSourceColor, saveSourceColor, getSourceStateFilePath } from '../../src/common.js'

describe('sourceColor Unit Tests', () => {
  const testSource = 'test-owner/test-repo'
  let stateFile

  beforeEach(() => {
    stateFile = getSourceStateFilePath(testSource)
    if (stateFile && fs.existsSync(stateFile)) {
      try { fs.unlinkSync(stateFile) } catch (e) {}
    }
  })

  afterEach(() => {
    if (stateFile && fs.existsSync(stateFile)) {
      try { fs.unlinkSync(stateFile) } catch (e) {}
    }
  })

  test('getSourceStateFilePath returns path under .jules-cache/sources', () => {
    const filePath = getSourceStateFilePath('github/owner/repo')
    assert.strictEqual(path.basename(filePath), 'github__owner__repo.json')
    assert.match(filePath, /\.jules-cache[/\\]sources/)
  })

  test('saveSourceColor and loadSourceColor persist color per source', () => {
    assert.strictEqual(loadSourceColor(testSource), null)

    saveSourceColor(testSource, 'cyan')
    assert.strictEqual(loadSourceColor(testSource), 'cyan')

    assert.strictEqual(fs.existsSync(stateFile), true)
    const fileContent = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.strictEqual(fileContent.color, 'cyan')
  })

  test('saveSourceColor with null removes color', () => {
    saveSourceColor(testSource, 'magenta')
    assert.strictEqual(loadSourceColor(testSource), 'magenta')

    saveSourceColor(testSource, null)
    assert.strictEqual(loadSourceColor(testSource), null)
  })
})
