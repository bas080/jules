import { test, describe } from 'node:test'
import assert from 'node:assert'
import { execSync } from 'node:child_process'
import { computeInterdiff } from '../interdiff.mjs'

describe('JS Interdiff against Real Repository Patches', () => {
  test('computes interdiff between consecutive real git diffs from local repo', () => {
    // Generate real cumulative patches from git log
    try {
      const commitCount = parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim(), 10)
      if (commitCount < 2) {
        // Fallback or skip if repository has fewer than 2 commits
        assert.ok(true)
        return
      }

      const patch1 = execSync('git diff HEAD~2 HEAD~1', { encoding: 'utf8' })
      const patch2 = execSync('git diff HEAD~2 HEAD', { encoding: 'utf8' })

      const interdiff = computeInterdiff(patch1, patch2)
      assert.strictEqual(typeof interdiff, 'string')

      if (patch1.trim() === patch2.trim()) {
        assert.strictEqual(interdiff, '')
      } else {
        assert.ok(interdiff.length > 0, 'interdiff should produce non-empty diff string')
        assert.match(interdiff, /diff --git a\/.* b\/.*/)
      }
    } catch (err) {
      assert.fail(`Error generating or computing real git patch interdiff: ${err.message}`)
    }
  })
})
