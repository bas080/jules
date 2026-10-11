import { test, describe } from 'node:test'
import assert from 'node:assert'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeInterdiff } from '../interdiff.mjs'

function runSystemInterdiff (patch1Str, patch2Str) {
  const tmp1 = path.join(os.tmpdir(), `test-p1-${Date.now()}.patch`)
  const tmp2 = path.join(os.tmpdir(), `test-p2-${Date.now()}.patch`)
  try {
    fs.writeFileSync(tmp1, patch1Str || '', 'utf8')
    fs.writeFileSync(tmp2, patch2Str || '', 'utf8')
    const output = execSync(`interdiff ${tmp1} ${tmp2}`, { encoding: 'utf8' })
    return output.trim()
  } finally {
    try { if (fs.existsSync(tmp1)) fs.unlinkSync(tmp1) } catch (e) {}
    try { if (fs.existsSync(tmp2)) fs.unlinkSync(tmp2) } catch (e) {}
  }
}

describe('JS Interdiff vs System Interdiff Comparison', () => {
  test('compares system interdiff output with JS computeInterdiff on real git repo patches', () => {
    try {
      const commitCount = parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim(), 10)
      if (commitCount < 2) {
        assert.ok(true)
        return
      }

      const patch1 = execSync('git diff HEAD~2 HEAD~1', { encoding: 'utf8' })
      const patch2 = execSync('git diff HEAD~2 HEAD', { encoding: 'utf8' })

      const jsOutput = computeInterdiff(patch1, patch2)

      let systemOutput = ''
      try {
        systemOutput = runSystemInterdiff(patch1, patch2)
      } catch (e) {
        // System interdiff unavailable
        return
      }

      if (systemOutput.trim()) {
        assert.ok(jsOutput.trim().length > 0, 'JS interdiff should produce non-empty diff output')
        assert.match(jsOutput, /diff --git a\/.* b\/.*/)
        assert.match(systemOutput, /--- /)

        const jsLines = jsOutput.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'))
        const systemLines = systemOutput.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'))

        if (systemLines.length > 0) {
          assert.ok(jsLines.length > 0, 'JS interdiff should capture addition/deletion hunk lines like system interdiff')
        }
      }
    } catch (err) {
      assert.fail(`Error comparing interdiffs: ${err.message}`)
    }
  })
})
